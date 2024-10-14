const express = require('express');
const axios = require('axios');
const app = express();

// 환경변수 및 상수
const {
  DISCORD_WEBHOOK_URL,
  FIGMA_API_TOKEN,
  REPLACE_WORDS,
  PROJECT_NAME,
  COMMENT_ENDPOINT,
  VERSION_ENDPOINT
} = process.env;

const replaceWords = JSON.parse(REPLACE_WORDS);
const replaceRegex = createRegexFromWords(replaceWords);

// 미들웨어
app.use(express.json());

// 유틸리티 함수
function createRegexFromWords(words) {
  const regexStrings = words.map(wordObj => `(${wordObj.word})`);
  return new RegExp(regexStrings.join('|'), 'g');
}

// 코멘트 본문 처리 함수
function replaceText(text) {
  return text.replace(replaceRegex, match => {
    const matchedWordObj = replaceWords.find(wordObj => wordObj.word === match);
    return matchedWordObj ? matchedWordObj.replacement : match;
  });
}

// Node ID를 가져오는 함수
async function getNodeIdFromComment(commentId, fileKey) {
  try {
    const url = `https://api.figma.com/v1/files/${fileKey}/comments`;
    const headers = { 'X-Figma-Token': FIGMA_API_TOKEN };
    const response = await axios.get(url, { headers });

    if (response.status === 403 || response.status === 404) {
      console.error(`Error ${response.status}: Check your API token and file key.`);
      return null;
    }

    const comment = response.data.comments.find(c => c.id === commentId);
    return comment ? comment.client_meta.node_id : null;
  } catch (error) {
    console.error('Error fetching node ID from comment:', error.response?.data || error.message);
    return null;
  }
}

// 부모 코멘트 원문을 가져오는 함수
async function getParentComment(parent_id, fileKey) {
  try {
    const url = `https://api.figma.com/v1/files/${fileKey}/comments`;
    const headers = { 'X-Figma-Token': FIGMA_API_TOKEN };
    const response = await axios.get(url, { headers });

    if (response.status === 403 || response.status === 404) {
      console.error(`Error ${response.status}: Check your API token and file key.`);
      return null;
    }

    const parentComment = response.data.comments.find(c => c.id === parent_id);
    return parentComment ? parentComment.message : null;
  } catch (error) {
    console.error('Error fetching parent comment:', error.response?.data || error.message);
    return null;
  }
}

async function handleFileComment(req, res) {
  const { comment, file_name, file_key, comment_id, triggered_by, timestamp, parent_id } = req.body;

  if (file_name !== PROJECT_NAME) {
    return res.status(400).send('Unknown file name');
  }

  let message = "";

  if (parent_id) {
    const parentComment = await getParentComment(parent_id, file_key);
    message += `>>> \`${replaceText(parentComment)}\`\n\n`;
  }

  if (Array.isArray(comment)) {
    comment.forEach(item => {
      if (item.text) {
        message += `${replaceText(item.text)}\n`;
      } else if (item.mention) {
        message += `Mentioned user: ${item.mention}\n`;
      }
    });
  } else if (comment.text) {
    message += `${replaceText(comment.text)}\n`;
  }

  const node_id = await getNodeIdFromComment(parent_id == "" ? comment_id : parent_id, file_key);
  if (!node_id) {
    return res.status(404).json({ success: false, message: 'Node ID not found' });
  }

  try {
    await axios.post(DISCORD_WEBHOOK_URL, { embeds: [{
      "author": {
        "name": triggered_by.handle,
        "icon_url": triggered_by.img_url
      },
      "title": `[${file_name}] ${(parent_id) ? 'New reply on comment' : 'New comment thread on design'}`,
      "url": `https://www.figma.com/design/${file_key}?node-id=${node_id}#${parent_id ? parent_id : comment_id}`,
      "description": message,
      "image": {
        "url": `${(parent_id) ? 'https://media1.tenor.com/m/Be-YL9ewKnMAAAAC/diseñadorcliente4.gif' : 'https://media1.tenor.com/m/ehqokSFplPIAAAAd/design-designer.gif'}`
      },
      "timestamp": timestamp,
      "color": `${(parent_id) ? '3244390' : '8482097'}`
    }]});
    res.status(200).send('Notification sent');
  } catch (error) {
    console.error('Error sending notification to Discord:', error.response?.data || error.message);
    res.status(500).send('Error sending notification');
  }
}

const processedEvents = new Set();

async function handleVersionUpdate(req, res) {
  const { event_id, file_name, file_key, triggered_by, description, label, timestamp } = req.body;

  /*
  if (processedEvents.has(event_id)) {
    return res.status(200).json({ message: 'Duplicate event ignored' });
  }
  processedEvents.add(event_id);
  */

  if (file_name !== PROJECT_NAME) {
    return res.status(400).send('Unknown file name');
  }

  try {
    await axios.post(DISCORD_WEBHOOK_URL, { embeds: [{
      "author": {
        "name": triggered_by.handle,
        "icon_url": triggered_by.img_url
      },
      "title": `[${file_name}] **New version update on design: ${label}**`,
      "url": `https://www.figma.com/design/${file_key}/%F0%9F%8C%A7%EF%B8%8F-ON%C2%B0C`,
      "description": `>>> ${description}`,
      "image": {
        "url": "https://i.namu.wiki/i/vcPIh-2LKgTCpeKuzLpVs1uGs9RHtZDezU438Wk5za0W18Zf_A9k7OO9kAz4yzWW31KjB2Talrzbldmvjv5KGw.gif"
      },
      "timestamp": timestamp,
      "color": `2379919`
    }]});
    res.status(200).send('Notification sent');
  } catch (error) {
    console.error('Error sending notification to Discord:', error.response?.data || error.message);
    res.status(500).send('Error sending notification');
  }
}

// 라우트
app.post(COMMENT_ENDPOINT, handleFileComment);
app.post(VERSION_ENDPOINT, handleVersionUpdate);

module.exports = app;