---
layout: redirect
redirect: 404
permalink: /chat
---
<!-- 
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Materio - Chat</title>
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link id="highlight-theme" rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.8/katex.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.8/katex.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.8/contrib/auto-render.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.2/marked.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
            transition: background-color 0.3s ease, color 0.3s ease;
        }

        :root {
            --bg-primary: #212121;
            --bg-secondary: #2f2f2f;
            --bg-tertiary: #424242;
            --text-primary: #ececec;
            --text-secondary: rgba(236, 236, 236, 0.6);
            --accent: #ff8200;
            --accent-hover: #e6750e;
            --border: #424242;
            --shadow: rgba(0, 0, 0, 0.3);
        }

        [data-theme="light"] {
            --bg-primary: #ffffff;
            --bg-secondary: #f5f5f5;
            --bg-tertiary: #e0e0e0;
            --text-primary: #212121;
            --text-secondary: rgba(33, 33, 33, 0.6);
            --accent: #ff8200;
            --accent-hover: #e6750e;
            --border: #e0e0e0;
            --shadow: rgba(0, 0, 0, 0.1);
        }

        .header {
            background-color: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            padding: 12px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: relative;
        }

        .header-left {
            display: flex;
            align-items: center;
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .theme-toggle {
            background: none;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 8px 12px;
            color: var(--text-primary);
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .theme-toggle:hover {
            background-color: var(--bg-tertiary);
        }

        .logo-container {
            display: flex;
            align-items: center;
            cursor: pointer;
            gap: 8px;
        }

        .logo {
            font-size: 20px;
            font-weight: 600;
            color: #ff8200;
        }

        .chevron-down {
            width: 16px;
            height: 16px;
            stroke: var(--text-primary);
            transition: transform 0.2s;
        }

        .logo-container.active .chevron-down {
            transform: rotate(180deg);
        }

        .model-dropdown-container {
            position: absolute;
            top: 100%;
            left: 20px;
            z-index: 1000;
            background-color: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 8px 0;
            min-width: 200px;
            display: none;
            box-shadow: 0 4px 12px var(--shadow);
        }

        .model-dropdown-container.show {
            display: block;
        }

        .model-option {
            padding: 10px 16px;
            cursor: pointer;
            color: var(--text-primary);
            font-size: 14px;
            transition: background-color 0.2s;
        }

        .model-option:hover {
            background-color: var(--bg-tertiary);
        }

        .model-option.selected {
            background-color: var(--accent);
            color: white;
        }

        .model-dropdown:focus {
            outline: none;
            border-color: #ff8200;
        }

        .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }

        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .welcome-container {
            position: absolute;
            top: 40%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            z-index: 5;
            transition: opacity 0.5s ease;
        }

        .welcome-container.hidden {
            opacity: 0;
            pointer-events: none;
        }

        .welcome-message {
            font-size: 24px;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 40px;
            opacity: 0;
            animation: fadeInOut 4s ease-in-out infinite;
        }

        @keyframes fadeInOut {
            0%, 100% { opacity: 0; }
            50% { opacity: 1; }
        }

        .message {
            display: flex;
            gap: 12px;
            max-width: 100%;
            margin-bottom: 20px;
        }

        .message.user {
            justify-content: flex-end;
            margin-right: calc((100% - 800px) / 2);
        }

        .message.assistant {
            justify-content: center;
        }

        .user-message {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 18px;
            font-size: 15px;
            line-height: 1.5;
            word-wrap: break-word;
            background-color: var(--bg-secondary);
            color: var(--text-primary);
        }

        .ai-response {
            max-width: 800px;
            width: 100%;
            margin: 0 auto;
            font-size: 15px;
            line-height: 1.5;
            word-wrap: break-word;
            color: var(--text-primary);
        }

        .input-container {
            padding: 20px;
            background-color: transparent;
            transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .input-container.centered {
            position: absolute;
            top: 55%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 100%;
            z-index: 10;
        }

        .input-container.bottom {
            position: relative;
            transform: translateY(0);
        }

        .input-wrapper {
            position: relative;
            max-width: 800px;
            margin: 0 auto;
            background-color: rgba(47, 47, 47, 0.4);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(86, 86, 86, 0.3);
            border-radius: 20px;
            padding: 16px;
            box-shadow: 0 8px 32px var(--shadow);
        }

        [data-theme="light"] .input-wrapper {
            background-color: rgba(245, 245, 245, 0.8);
            border: 1px solid rgba(224, 224, 224, 0.5);
        }

        .input-controls {
            position: absolute;
            left: 16px;
            bottom: 16px;
            display: flex;
            gap: 8px;
            align-items: center;
            z-index: 10;
        }

        .mode-button {
            width: 32px;
            height: 32px;
            border: 1px solid var(--border);
            background-color: rgba(66, 66, 66, 0.8);
            color: var(--text-primary);
            border-radius: 50%;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            backdrop-filter: blur(10px);
        }

        [data-theme="light"] .mode-button {
            background-color: rgba(224, 224, 224, 0.8);
        }

        .mode-button:hover {
            background-color: rgba(86, 86, 86, 0.8);
        }

        [data-theme="light"] .mode-button:hover {
            background-color: rgba(189, 189, 189, 0.8);
        }

        .mode-button.active {
            background-color: rgba(255, 130, 0, 0.8);
            border-color: #ff8200;
            color: white;
        }

        .input-box {
            width: 100%;
            min-height: 50px;
            max-height: 200px;
            padding: 12px 60px 50px 16px;
            border: none;
            border-radius: 12px;
            background-color: transparent;
            color: var(--text-primary);
            font-size: 16px;
            font-family: 'Manrope', sans-serif;
            resize: none;
            outline: none;
        }

        .input-box::placeholder {
            color: var(--text-secondary);
        }

        .send-button {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            width: 36px;
            height: 36px;
            border-radius: 8px;
            border: none;
            background-color: #ff8200;
            color: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s;
        }

        .send-button:hover:not(:disabled) {
            background-color: #e6750e;
        }

        .send-button:disabled {
            background-color: #666;
            cursor: not-allowed;
        }

        .thinking {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #ff8200;
            font-style: italic;
        }

        .thinking-dots {
            display: flex;
            gap: 4px;
        }

        .thinking-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: #ff8200;
            animation: thinking 1.4s infinite ease-in-out;
        }

        .thinking-dot:nth-child(1) { animation-delay: -0.32s; }
        .thinking-dot:nth-child(2) { animation-delay: -0.16s; }

        @keyframes thinking {
            0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
            40% { transform: scale(1); opacity: 1; }
        }

        /* Markdown styles */
        .ai-response h1, .ai-response h2, .ai-response h3,
        .ai-response h4, .ai-response h5, .ai-response h6 {
            margin: 16px 0 8px 0;
            color: var(--text-primary);
        }

        .ai-response p {
            margin: 8px 0;
        }

        .ai-response ul, .ai-response ol {
            margin: 8px 0;
            padding-left: 20px;
        }

        .ai-response li {
            margin: 4px 0;
        }

        .ai-response blockquote {
            border-left: 4px solid #ff8200;
            padding-left: 16px;
            margin: 16px 0;
            color: var(--text-secondary);
        }

        .ai-response pre {
            background-color: var(--bg-tertiary);
            border-radius: 8px;
            padding: 16px;
            margin: 12px 0;
            overflow-x: auto;
            border: 1px solid var(--border);
        }

        .ai-response code {
            background-color: var(--bg-tertiary);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 14px;
        }

        .ai-response pre code {
            background-color: transparent;
            padding: 0;
        }

        .ai-response table {
            border-collapse: collapse;
            width: 100%;
            margin: 12px 0;
        }

        .ai-response th, .ai-response td {
            border: 1px solid var(--border);
            padding: 8px 12px;
            text-align: left;
        }

        .ai-response th {
            background-color: var(--bg-secondary);
            font-weight: 600;
        }

        /* Scrollbar styles */
        .messages-container::-webkit-scrollbar {
            width: 8px;
        }

        .messages-container::-webkit-scrollbar-track {
            background: var(--bg-secondary);
        }

        .messages-container::-webkit-scrollbar-thumb {
            background: var(--bg-tertiary);
            border-radius: 4px;
        }

        .messages-container::-webkit-scrollbar-thumb:hover {
            background: #6f6f6f;
        }

        .error-message {
            color: #ff6b6b;
            background-color: #2d1b1b;
            border: 1px solid #4a2525;
            padding: 12px;
            border-radius: 8px;
            margin: 8px 0;
        }

        @media (max-width: 768px) {
            .message-content {
                max-width: 85%;
            }
            
            .input-container {
                padding: 16px;
            }
            
            .input-controls {
                flex-wrap: wrap;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <div class="logo-container" id="logoContainer">
                <div class="logo">Materio</div>
                <svg class="chevron-down" viewBox="0 0 24 24" fill="none">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
        </div>
        <div class="header-right">
            <button class="theme-toggle" id="themeToggle">
                <span id="themeIcon">🌙</span>
                <span id="themeText">Dark</span>
            </button>
        </div>
        <div class="model-dropdown-container" id="modelDropdown">
            <!-- Models will be populated dynamically -->
        </div>
    </div>

    <div class="chat-container">
        <div class="welcome-container" id="welcomeContainer">
            <div class="welcome-message" id="welcomeMessage">What's on your curious mind today?</div>
        </div>
        
        <div id="messagesContainer" class="messages-container">
        </div>

        <div class="input-container centered" id="inputContainer">
            <div class="input-wrapper">
                <div class="input-controls">
                    <button id="reasoningBtn" class="mode-button" data-mode="reasoning">
                        🧠
                    </button>
                    <button id="codeBtn" class="mode-button" data-mode="code">
                        💻
                    </button>
                </div>
                <div style="position: relative;">
                    <textarea id="messageInput" class="input-box" placeholder="Ask anything" rows="1"></textarea>
                    <button id="sendBtn" class="send-button">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22,2 15,22 11,13 2,9"></polygon>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <script>
        class ChatInterface {
            constructor() {
                this.messages = [];
                this.currentMode = 'general';
                this.isThinking = false;
                this.selectedModel = null;
                this.availableModels = [];
                this.modelsByMode = {};
                this.apiBaseUrl = this.getApiBaseUrl();
                this.welcomeMessages = [
                    "What's on your curious mind today?",
                    "Want some help?",
                    "Hello, how may I help you?",
                    "What can I do for you today?",
                    "Ready to explore together?",
                    "What would you like to know?",
                    "How can I assist you?",
                    "Let's solve something interesting!"
                ];
                this.currentMessageIndex = 0;
                this.isFirstMessage = true;
                
                this.initializeElements();
                this.setupEventListeners();
                this.loadModels();
                this.startWelcomeMessageRotation();
                this.loadSavedTheme();
            }

            getApiBaseUrl() {
                // Check if we're running locally or on Netlify
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    return 'http://localhost:8888/api/v1/chat';
                } else {
                    return '/api/v1/chat';
                }
            }

            initializeElements() {
                this.messagesContainer = document.getElementById('messagesContainer');
                this.messageInput = document.getElementById('messageInput');
                this.sendBtn = document.getElementById('sendBtn');
                this.reasoningBtn = document.getElementById('reasoningBtn');
                this.codeBtn = document.getElementById('codeBtn');
                this.logoContainer = document.getElementById('logoContainer');
                this.modelDropdown = document.getElementById('modelDropdown');
                this.welcomeContainer = document.getElementById('welcomeContainer');
                this.welcomeMessage = document.getElementById('welcomeMessage');
                this.inputContainer = document.getElementById('inputContainer');
                this.themeToggle = document.getElementById('themeToggle');
                this.themeIcon = document.getElementById('themeIcon');
                this.themeText = document.getElementById('themeText');
            }

            async loadModels() {
                try {
                    const response = await fetch(`${this.apiBaseUrl}/models`);
                    const data = await response.json();
                    
                    if (data.success) {
                        this.availableModels = data.models;
                        this.modelsByMode = data.modelsByMode;
                        this.populateModelDropdown();
                        this.updateModelBasedOnMode();
                    } else {
                        console.error('Failed to load models:', data.error);
                        this.showError('Failed to load available models');
                    }
                } catch (error) {
                    console.error('Error loading models:', error);
                    this.showError('Error connecting to chat API');
                }
            }

            populateModelDropdown() {
                const modelDropdown = document.getElementById('modelDropdown');
                modelDropdown.innerHTML = '';
                
                this.availableModels.forEach(model => {
                    const option = document.createElement('div');
                    option.className = 'model-option';
                    option.dataset.model = model.id;
                    option.textContent = model.name;
                    option.addEventListener('click', (e) => {
                        this.selectedModel = e.target.dataset.model;
                        document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('selected'));
                        e.target.classList.add('selected');
                        this.logoContainer.classList.remove('active');
                        this.modelDropdown.classList.remove('show');
                    });
                    modelDropdown.appendChild(option);
                });
            }

            startWelcomeMessageRotation() {
                setInterval(() => {
                    if (this.isFirstMessage) {
                        this.currentMessageIndex = (this.currentMessageIndex + 1) % this.welcomeMessages.length;
                        this.welcomeMessage.textContent = this.welcomeMessages[this.currentMessageIndex];
                    }
                }, 4000);
            }

            setupEventListeners() {
                this.sendBtn.addEventListener('click', () => this.sendMessage());
                this.messageInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.sendMessage();
                    }
                });

                this.messageInput.addEventListener('input', () => {
                    this.autoResize();
                });

                this.reasoningBtn.addEventListener('click', () => this.setMode('reasoning'));
                this.codeBtn.addEventListener('click', () => this.setMode('code'));

                // Theme toggle functionality
                this.themeToggle.addEventListener('click', () => this.toggleTheme());

                // Model dropdown functionality
                this.logoContainer.addEventListener('click', () => {
                    this.logoContainer.classList.toggle('active');
                    this.modelDropdown.classList.toggle('show');
                });

                // Close dropdown when clicking outside
                document.addEventListener('click', (e) => {
                    if (!this.logoContainer.contains(e.target) && !this.modelDropdown.contains(e.target)) {
                        this.logoContainer.classList.remove('active');
                        this.modelDropdown.classList.remove('show');
                    }
                });

                // Model selection is now handled in populateModelDropdown()

                // Set initial model selection when models are loaded
            }

            toggleTheme() {
                const currentTheme = document.documentElement.getAttribute('data-theme');
                const newTheme = currentTheme === 'light' ? 'dark' : 'light';
                
                document.documentElement.setAttribute('data-theme', newTheme);
                
                // Update highlight.js theme
                this.updateHighlightTheme(newTheme);
                
                if (newTheme === 'light') {
                    this.themeIcon.textContent = '☀️';
                    this.themeText.textContent = 'Light';
                } else {
                    this.themeIcon.textContent = '🌙';
                    this.themeText.textContent = 'Dark';
                }
                
                // Save theme preference
                localStorage.setItem('theme', newTheme);
            }

            updateHighlightTheme(theme) {
                const highlightThemeLink = document.getElementById('highlight-theme');
                if (theme === 'light') {
                    highlightThemeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
                } else {
                    highlightThemeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
                }
            }

            loadSavedTheme() {
                const savedTheme = localStorage.getItem('theme') || 'dark';
                document.documentElement.setAttribute('data-theme', savedTheme);
                
                // Update highlight.js theme
                this.updateHighlightTheme(savedTheme);
                
                if (savedTheme === 'light') {
                    this.themeIcon.textContent = '☀️';
                    this.themeText.textContent = 'Light';
                } else {
                    this.themeIcon.textContent = '🌙';
                    this.themeText.textContent = 'Dark';
                }
            }

            autoResize() {
                this.messageInput.style.height = 'auto';
                this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 200) + 'px';
            }

            setMode(mode) {
                this.currentMode = mode;
                
                // Update button states
                document.querySelectorAll('.mode-button').forEach(btn => {
                    btn.classList.remove('active');
                });
                
                if (mode === 'reasoning') {
                    this.reasoningBtn.classList.add('active');
                } else if (mode === 'code') {
                    this.codeBtn.classList.add('active');
                }
                
                this.updateModelBasedOnMode();
            }

            updateModelBasedOnMode() {
                if (!this.modelsByMode || !this.modelsByMode[this.currentMode]) {
                    return; // Models not loaded yet
                }

                const preferredModels = this.modelsByMode[this.currentMode];
                
                // Set the first preferred model as selected
                if (preferredModels.length > 0) {
                    this.selectedModel = preferredModels[0];
                    
                    // Update UI to show selected model
                    document.querySelectorAll('.model-option').forEach(opt => {
                        opt.classList.remove('selected');
                        if (opt.dataset.model === this.selectedModel) {
                            opt.classList.add('selected');
                        }
                    });
                }
            }

            async sendMessage() {
                const message = this.messageInput.value.trim();
                
                if (!message) return;
                if (this.isThinking) return;

                // Handle first message transition
                if (this.isFirstMessage) {
                    this.isFirstMessage = false;
                    this.welcomeContainer.classList.add('hidden');
                    this.inputContainer.classList.remove('centered');
                    this.inputContainer.classList.add('bottom');
                }

                // Add user message
                this.addMessage('user', message);
                this.messageInput.value = '';
                this.autoResize();

                // Show thinking indicator
                this.showThinking();

                try {
                    const response = await this.callChatAPI(message);
                    this.hideThinking();
                    this.addMessage('assistant', response.response);
                } catch (error) {
                    this.hideThinking();
                    this.showError('Error: ' + error.message);
                }
            }

            async callChatAPI(message) {
                const response = await fetch(this.apiBaseUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: message,
                        mode: this.currentMode,
                        model: this.selectedModel,
                        messages: this.messages.map(msg => ({
                            role: msg.role,
                            content: msg.content
                        }))
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                }

                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.error || 'Unknown error');
                }
                
                return data;
            }

            addMessage(role, content) {
                this.messages.push({ role, content });
                
                const messageDiv = document.createElement('div');
                messageDiv.className = `message ${role}`;
                
                if (role === 'user') {
                    const userMessageDiv = document.createElement('div');
                    userMessageDiv.className = 'user-message';
                    userMessageDiv.textContent = content;
                    messageDiv.appendChild(userMessageDiv);
                } else {
                    const aiResponseDiv = document.createElement('div');
                    aiResponseDiv.className = 'ai-response';
                    aiResponseDiv.innerHTML = this.renderMarkdown(content);
                    this.renderMath(aiResponseDiv);
                    messageDiv.appendChild(aiResponseDiv);
                }
                
                this.messagesContainer.appendChild(messageDiv);
                this.scrollToBottom();
            }

            renderMarkdown(content) {
                // Configure marked for better code highlighting
                marked.setOptions({
                    highlight: function(code, lang) {
                        if (lang && hljs.getLanguage(lang)) {
                            try {
                                return hljs.highlight(code, { language: lang }).value;
                            } catch (err) {}
                        }
                        return hljs.highlightAuto(code).value;
                    },
                    breaks: true,
                    gfm: true
                });
                
                const htmlContent = marked.parse(content);
                
                // Apply highlight.js to any code blocks that weren't processed by marked
                setTimeout(() => {
                    document.querySelectorAll('pre code').forEach(block => {
                        if (!block.classList.contains('hljs')) {
                            hljs.highlightElement(block);
                        }
                    });
                }, 0);
                
                return htmlContent;
            }

            renderMath(element) {
                renderMathInElement(element, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\[', right: '\\]', display: true},
                        {left: '\\(', right: '\\)', display: false}
                    ],
                    throwOnError: false
                });
            }

            showThinking() {
                this.isThinking = true;
                this.sendBtn.disabled = true;
                
                const thinkingDiv = document.createElement('div');
                thinkingDiv.className = 'message assistant';
                thinkingDiv.id = 'thinking-message';
                
                const content = document.createElement('div');
                content.className = 'ai-response thinking';
                content.innerHTML = `
                    <span>Thinking</span>
                    <div class="thinking-dots">
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                    </div>
                `;
                
                thinkingDiv.appendChild(content);
                
                this.messagesContainer.appendChild(thinkingDiv);
                this.scrollToBottom();
            }

            hideThinking() {
                this.isThinking = false;
                this.sendBtn.disabled = false;
                
                const thinkingMessage = document.getElementById('thinking-message');
                if (thinkingMessage) {
                    thinkingMessage.remove();
                }
            }

            showError(message) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error-message';
                errorDiv.textContent = message;
                
                this.messagesContainer.appendChild(errorDiv);
                this.scrollToBottom();
                
                setTimeout(() => {
                    errorDiv.remove();
                }, 5000);
            }

            scrollToBottom() {
                this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            }
        }

        // Initialize the chat interface
        document.addEventListener('DOMContentLoaded', () => {
            new ChatInterface();
        });
    </script>
</body>
</html> -->