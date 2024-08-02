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

function replaceText(text) {
  return text.replace(replaceRegex, match => {
    const matchedWordObj = replaceWords.find(wordObj => wordObj.word === match);
    return matchedWordObj ? matchedWordObj.replacement : match;
  });
}

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
    return comment ? (comment.client_meta.node_id || comment.client_meta.node_id) : null;
  } catch (error) {
    console.error('Error fetching node ID from comment:', error.response?.data || error.message);
    return null;
  }
}

async function handleFileComment(req, res) {
  const { comment, file_name, file_key, comment_id, triggered_by, created_at, parent_id } = req.body;

  if (file_name !== '🌧️ ON°C') {
    return res.status(400).send('Unknown file name');
  }

  let message = `# ${file_name}에 새 `;
  message += parent_id ? '댓글' : '코멘트';
  message += `가 있어요!\n\`${created_at}\n`;
  message += `${parent_id ? '댓글' : '코멘트'}by ${triggered_by.handle}\`\n\n`;

  if (parent_id) {
    // 댓글인 경우, 원래 코멘트 정보 가져오기
    const parentComment = await getParentComment(parent_id, file_key);
    if (parentComment) {
      message += `## 원래 코멘트:\n${replaceText(parentComment.text)}\n\n`;
    }
    message += `## 댓글:\n`;
  } else {
    message += `## 코멘트:\n`;
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

  const node_id = await getNodeIdFromComment(comment_id, file_key);
  if (!node_id) {
    return res.status(404).json({ success: false, message: 'Node ID not found' });
  }

  message += `\n### ${parent_id ? '댓글' : '코멘트'} 링크\nhttps://www.figma.com/file/${file_key}?node-id=${node_id}#${comment_id}\n`;

  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content: message });
    res.status(200).send('Notification sent');
  } catch (error) {
    console.error('Error sending notification to Discord:', error.response?.data || error.message);
    res.status(500).send('Error sending notification');
  }
}

// 부모 코멘트 정보를 가져오는 함수
async function getParentComment(parent_id, file_key) {
  try {
    const response = await axios.get(`https://api.figma.com/v1/files/${file_key}/comments/${parent_id}`, {
      headers: {
        'X-Figma-Token': FIGMA_ACCESS_TOKEN
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching parent comment:', error);
    return null;
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