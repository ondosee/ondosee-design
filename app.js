const express = require('express');
const axios = require('axios');
const app = express();

// 환경변수 및 상수
const {
  DISCORD_WEBHOOK_URL,
  FIGMA_API_TOKEN,
  REPLACE_WORDS, // 디스코드 멘션으로 치환할 단어 (ex: @Designer)
  PROJECT_NAME, // 피그마 프로젝트명 (Warning: 이모지 포함 불가)
  COMMENT_ENDPOINT, // event_type이 FILE_COMMENT인 웹훅의 엔드포인트
  VERSION_ENDPOINT // event_type이 FILE_VERSION_UPDATE인 웹훅의 엔드포인트
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

// 디스코드 메세지 작성 (FILE_COMMENT)
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

  const node_id = await getNodeIdFromComment(parent_id == "" ? comment_id : parent_id, file_key); // Reply의 경우 parent의 node_id를 가져와야 하므로 parent_id를 사용해서 getNodeId
  if (!node_id) {
    return res.status(404).json({ success: false, message: 'Node ID not found' });
  }

  try {
    await axios.post(DISCORD_WEBHOOK_URL, { embeds: [{ // 임베드 형식으로 디스코드 메세지를 작성
      "author": {
        "name": triggered_by.handle,
        "icon_url": triggered_by.img_url
      },
      "title": `[${file_name}] ${(parent_id) ? 'New reply on comment' : 'New comment thread on design'}`,
      "url": `https://www.figma.com/design/${file_key}?node-id=${node_id}#${parent_id ? parent_id : comment_id}`, // node_id를 사용하여 코멘트 위치로 통하는 피그마 링크를 생성
      "description": message,
      "image": {
        "url": `${(parent_id) ? 'https://media1.tenor.com/m/Be-YL9ewKnMAAAAC/diseñadorcliente4.gif' : 'https://media1.tenor.com/m/ehqokSFplPIAAAAd/design-designer.gif'}` // 이미지 (임의로 변경 가능)
      },
      "timestamp": timestamp,
      "color": `${(parent_id) ? '3244390' : '8482097'}` // 디스코드 임베드 블록 컬러 (Reply : Comment)
    }]});
    res.status(200).send('Notification sent');
  } catch (error) {
    console.error('Error sending notification to Discord:', error.response?.data || error.message);
    res.status(500).send('Error sending notification');
  }
}

// 디스코드 메세지 작성 (FILE_VERSION_UPDATE)
async function handleVersionUpdate(req, res) {
  const { file_name, file_key, triggered_by, description, label, timestamp } = req.body;

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
      "url": `https://www.figma.com/design/${file_key}/%F0%9F%8C%A7%EF%B8%8F-ON%C2%B0C`, // 위치 정보가 필요 없으므로 getNodeId 없이 링크 생성
      "description": `>>> ${description}`,
      "image": {
        "url": "https://i.namu.wiki/i/vcPIh-2LKgTCpeKuzLpVs1uGs9RHtZDezU438Wk5za0W18Zf_A9k7OO9kAz4yzWW31KjB2Talrzbldmvjv5KGw.gif" // 이미지 (임의로 변경 가능)
      },
      "timestamp": timestamp,
      "color": `2379919` // 디스코드 임베드 블록 컬러
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