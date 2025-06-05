const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

// In-memory storage (consider using a database for production)
let userConversations = new Map();

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method Not Allowed' })
        };
    }

    try {
        const update = JSON.parse(event.body);
        
        if (update.message) {
            await handleMessage(update.message);
        } else if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true })
        };
    } catch (error) {
        console.error('Webhook error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};

async function sendMessage(chatId, text, options = {}) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: options.parse_mode || 'Markdown',
        ...options
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    return response.json();
}

async function editMessage(chatId, messageId, text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`;
    
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'Markdown'
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    return response.json();
}

async function answerCallbackQuery(callbackQueryId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId })
    });

    return response.json();
}

async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const userMessage = msg.text;

    // Handle commands
    if (userMessage?.startsWith('/start')) {
        const welcomeMessage = `🤖 *Welcome to AI Assistant Bot!*

I'm your personal AI assistant powered by OpenAI. I can help you with:

🧠 *Answering questions*
✍️ *Creative writing*
📚 *Learning and explanations*
💻 *Technical assistance*
🎨 *Creative projects*
🔍 *Research and analysis*

Just send me a message and I'll respond! 

*Commands:*
/start - Show this welcome message
/clear - Clear conversation history
/help - Show help information
/model - Change AI model

Let's chat! 🚀`;

        await sendMessage(chatId, welcomeMessage);
        return;
    }

    if (userMessage?.startsWith('/help')) {
        const helpMessage = `🆘 *Help & Commands*

*Available Commands:*
/start - Welcome message
/clear - Clear your conversation history
/help - Show this help
/model - Change AI model (GPT-3.5/GPT-4)

*How to use:*
Just send me any message and I'll respond with AI-powered answers!

*Features:*
- Remembers conversation context
- Supports multiple AI models
- Fast and accurate responses
- Creative and analytical capabilities

*Tips:*
- Be specific in your questions
- Use /clear to start fresh conversations
- Try different models for different tasks`;

        await sendMessage(chatId, helpMessage);
        return;
    }

    if (userMessage?.startsWith('/clear')) {
        userConversations.delete(chatId);
        await sendMessage(chatId, '🗑️ *Conversation cleared!* \n\nYour chat history has been reset. Start a new conversation!');
        return;
    }

    if (userMessage?.startsWith('/model')) {
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '⚡ GPT-3.5 Turbo (Fast)', callback_data: 'model_gpt35' },
                        { text: '🧠 GPT-4 (Smart)', callback_data: 'model_gpt4' }
                    ]
                ]
            }
        };
        await sendMessage(chatId, '🤖 *Choose AI Model:*', keyboard);
        return;
    }

    // Handle regular messages
    if (!userMessage || userMessage.startsWith('/')) {
        return;
    }

    try {
        // Get or create user conversation
        if (!userConversations.has(chatId)) {
            userConversations.set(chatId, { 
                messages: [], 
                model: 'gpt-3.5-turbo' // default model
            });
        }

        const userConv = userConversations.get(chatId);
        
        // Add user message to conversation
        userConv.messages.push({ role: 'user', content: userMessage });

        // Keep conversation history manageable (last 10 exchanges)
        if (userConv.messages.length > 20) {
            userConv.messages = userConv.messages.slice(-20);
        }

        // Prepare messages with system prompt
        const systemPrompt = {
            role: 'system',
            content: `You are a helpful AI assistant on Telegram. Be friendly, concise, and helpful. 
            Use emojis appropriately but don't overuse them. 
            Format your responses clearly and break up long text into paragraphs.
            You can use *bold* and _italic_ text formatting.`
        };

        const messages = [systemPrompt, ...userConv.messages];

        // Call OpenAI API
        const completion = await openai.chat.completions.create({
            model: userConv.model,
            messages: messages,
            max_tokens: 1000,
            temperature: 0.7,
            presence_penalty: 0.1,
            frequency_penalty: 0.1
        });

        const aiResponse = completion.choices[0].message.content;

        // Add AI response to conversation
        userConv.messages.push({ role: 'assistant', content: aiResponse });

        // Send response to user
        await sendMessage(chatId, aiResponse);

    } catch (error) {
        console.error('Error:', error);
        
        let errorMessage = '❌ *Error occurred!*\n\n';
        
        if (error.code === 'insufficient_quota') {
            errorMessage += 'OpenAI API quota exceeded. Please check your billing.';
        } else if (error.code === 'invalid_api_key') {
            errorMessage += 'Invalid OpenAI API key configuration.';
        } else if (error.status === 429) {
            errorMessage += 'Rate limit exceeded. Please try again in a moment.';
        } else {
            errorMessage += 'Something went wrong. Please try again later.';
        }

        await sendMessage(chatId, errorMessage);
    }
}

async function handleCallbackQuery(callbackQuery) {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const data = callbackQuery.data;

    if (data.startsWith('model_')) {
        const model = data === 'model_gpt35' ? 'gpt-3.5-turbo' : 'gpt-4';
        
        // Store user's preferred model
        if (!userConversations.has(chatId)) {
            userConversations.set(chatId, { messages: [], model: model });
        } else {
            userConversations.get(chatId).model = model;
        }

        const modelName = model === 'gpt-3.5-turbo' ? 'GPT-3.5 Turbo ⚡' : 'GPT-4 🧠';
        await editMessage(chatId, message.message_id, `✅ *Model changed to ${modelName}*`);
    }

    await answerCallbackQuery(callbackQuery.id);
}
