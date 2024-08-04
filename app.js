const express = require('express');
const axios = require('axios');
const app = express();

// 환경변수 및 상수
const {
  DISCORD_WEBHOOK_URL,
  FIGMA_API_TOKEN,
  FILE_KEY,
  REPLACE_WORDS,
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
  const { comment, file_name, file_key, comment_id, triggered_by, created_at, parent_id } = req.body;

  if (file_name !== '🌧️ ON°C') {
    return res.status(400).send('Unknown file name');
  }

  let message = `# ${file_name}에 새 `;
  message += (parent_id == "") ? '코멘트가' : '댓글이';
  message += ` 있어요!\n\`${created_at}\`\n`;
  message += `\`${(parent_id == "") ? 'Commented' : 'Replied'} by ${triggered_by.handle}\`\n\n`;

  if (parent_id) {
    const parentComment = await getParentComment(parent_id, file_key);
    message += `> \`${replaceText(parentComment)}\`\n> \n> `;
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

  message += `\n### Go to Comment\nhttps://www.figma.com/design/${file_key}?node-id=${node_id}#${parent_id == "" ? comment_id : parent_id}\n`;


  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content: message });
    res.status(200).send('Notification sent');
  } catch (error) {
    console.error('Error sending notification to Discord:', error.response?.data || error.message);
    res.status(500).send('Error sending notification');
  }
}

const processedEvents = new Set();

function handleVersionUpdate(req, res) {
  const { event_type, event_id, file_name, triggered_by, description, label } = req.body;

  if (processedEvents.has(event_id)) {
    return res.status(200).json({ message: 'Duplicate event ignored' });
  }
  processedEvents.add(event_id);

  if (file_name !== '🌧️ ON°C') {
    return res.status(400).send('Unknown file name');
  }

  const message = `## ${file_name} 피그마가 버전업 했어요!\n\`updated by ${triggered_by.handle}\`\n\n### 버전명: ${label}\n${description}\n`;

  axios.post(DISCORD_WEBHOOK_URL, { content: message })
    .then(() => res.status(200).send('Notification sent'))
    .catch(error => {
      console.error('Error sending notification to Discord:', error.response?.data || error.message);
      res.status(500).send('Error sending notification');
    });
}

// 라우트
app.post('/ondosee-comment', handleFileComment);
app.post('/ondosee-version-up', handleVersionUpdate);

module.exports = app;