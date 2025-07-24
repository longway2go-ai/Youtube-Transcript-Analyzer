// Global variables
let currentTranscript = '';
let currentVideoId = '';
let chatHistory = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Add event listeners for Enter key
    document.getElementById('youtube-url').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            fetchTranscript();
        }
    });
    
    document.getElementById('question-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            askQuestion();
        }
    });
});

// Enhanced fetch function with proper error handling
async function safeFetchJSON(url, options) {
    try {
        const response = await fetch(url, options);
        
        // Check if response is ok (status 200-299)
        if (!response.ok) {
            let errorText;
            try {
                // Try to get error text from response
                errorText = await response.text();
            } catch {
                errorText = `HTTP ${response.status} ${response.statusText}`;
            }
            throw new Error(errorText);
        }
        
        // Try to parse JSON
        try {
            return await response.json();
        } catch (jsonError) {
            const text = await response.text();
            throw new Error(`Invalid JSON response: ${text}`);
        }
        
    } catch (networkError) {
        // Re-throw with more context
        throw new Error(`Network error: ${networkError.message}`);
    }
}

// Show/hide loading overlay
function showLoading(text = 'Processing...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

// Extract video ID for embedding
function getVideoIdFromUrl(url) {
    if (url.includes('watch?v=')) {
        return url.split('watch?v=')[1].split('&')[0];
    } else if (url.includes('youtu.be/')) {
        return url.split('youtu.be/')[1].split('?')[0];
    }
    return null;
}

// Fetch transcript from YouTube with proper error handling
async function fetchTranscript() {
    const url = document.getElementById('youtube-url').value.trim();
    const fetchBtn = document.getElementById('fetch-btn');
    
    if (!url) {
        showNotification('Please enter a YouTube URL', 'error');
        return;
    }
    
    // Update button state
    fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Extracting...';
    fetchBtn.disabled = true;
    
    showLoading('Extracting transcript from YouTube...');
    
    try {
        const data = await safeFetchJSON('/api/transcript', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: url })
        });
        
        if (data.success) {
            currentTranscript = data.transcript;
            currentVideoId = data.video_id;
            
            // Show transcript
            displayTranscript(data.transcript);
            
            // Show video preview
            showVideoPreview(url);
            
            // Show Q&A section
            document.getElementById('qa-section').classList.remove('hidden');
            document.getElementById('qa-section').classList.add('fade-in');
            
            showNotification('Transcript extracted successfully!', 'success');
        } else {
            showNotification('Error: ' + (data.error || 'Unknown error occurred'), 'error');
        }
    } catch (error) {
        console.error('Fetch transcript error:', error);
        showNotification(error.message, 'error');
    } finally {
        // Reset button state
        fetchBtn.innerHTML = '<i class="fas fa-download mr-2"></i> Extract Transcript';
        fetchBtn.disabled = false;
        hideLoading();
    }
}

// Display transcript in the UI
function displayTranscript(transcript) {
    const transcriptSection = document.getElementById('transcript-section');
    const transcriptContent = document.getElementById('transcript-content');
    const transcriptStats = document.getElementById('transcript-stats');
    
    transcriptContent.textContent = transcript;
    
    // Calculate statistics
    const wordCount = transcript.split(' ').length;
    const charCount = transcript.length;
    const readingTime = Math.ceil(wordCount / 200); // Average reading speed
    
    transcriptStats.innerHTML = `
        <i class="fas fa-chart-bar mr-1"></i>
        ${wordCount} words • ${charCount} characters • ~${readingTime} min read
    `;
    
    transcriptSection.classList.remove('hidden');
    transcriptSection.classList.add('fade-in');
}

// Show video preview
function showVideoPreview(url) {
    const videoPreview = document.getElementById('video-preview');
    const videoContainer = document.getElementById('video-container');
    const videoId = getVideoIdFromUrl(url);
    
    if (videoId) {
        videoContainer.innerHTML = `
            <div class="video-responsive">
                <iframe 
                    src="https://www.youtube.com/embed/${videoId}" 
                    frameborder="0" 
                    allowfullscreen
                ></iframe>
            </div>
        `;
        
        videoPreview.classList.remove('hidden');
        videoPreview.classList.add('fade-in');
    }
}

// Ask a question about the transcript with proper error handling
async function askQuestion() {
    const question = document.getElementById('question-input').value.trim();
    const askBtn = document.getElementById('ask-btn');
    
    if (!question) {
        showNotification('Please enter a question', 'error');
        return;
    }
    
    if (!currentTranscript) {
        showNotification('Please extract a transcript first', 'error');
        return;
    }
    
    // Update button state
    askBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Thinking...';
    askBtn.disabled = true;
    
    showLoading('Getting AI answer...');
    
    try {
        const data = await safeFetchJSON('/api/question', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                question: question,
                transcript: currentTranscript
            })
        });
        
        if (data.success) {
            displayAnswer(question, data.answer);
            addToChatHistory(question, data.answer);
            
            // Clear the question input
            document.getElementById('question-input').value = '';
            
            showNotification('Answer received!', 'success');
        } else {
            showNotification('Error: ' + (data.error || 'Unknown error occurred'), 'error');
        }
    } catch (error) {
        console.error('Ask question error:', error);
        showNotification(error.message, 'error');
    } finally {
        // Reset button state
        askBtn.innerHTML = '<i class="fas fa-magic mr-2"></i> Ask AI';
        askBtn.disabled = false;
        hideLoading();
    }
}

// Display the AI answer
function displayAnswer(question, answer) {
    const answerSection = document.getElementById('answer-section');
    const answerContent = document.getElementById('answer-content');
    
    answerContent.innerHTML = `
        <div class="mb-3">
            <strong class="text-gray-800">Question:</strong> ${question}
        </div>
        <div>
            <strong class="text-gray-800">Answer:</strong> ${answer}
        </div>
    `;
    
    answerSection.classList.remove('hidden');
    answerSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Add to chat history
function addToChatHistory(question, answer) {
    chatHistory.unshift({ question, answer, timestamp: new Date() });
    
    // Limit history to 10 items
    if (chatHistory.length > 10) {
        chatHistory = chatHistory.slice(0, 10);
    }
    
    updateChatHistoryDisplay();
}

// Update chat history display
function updateChatHistoryDisplay() {
    const chatHistorySection = document.getElementById('chat-history');
    const chatContainer = document.getElementById('chat-container');
    
    if (chatHistory.length === 0) {
        chatHistorySection.classList.add('hidden');
        return;
    }
    
    chatContainer.innerHTML = chatHistory.map((chat, index) => `
        <div class="chat-item">
            <div class="chat-question">
                Q${chatHistory.length - index}: ${chat.question}
            </div>
            <div class="chat-answer">
                ${chat.answer}
            </div>
            <div class="text-xs text-gray-400 mt-2">
                ${chat.timestamp.toLocaleTimeString()}
            </div>
        </div>
    `).join('');
    
    chatHistorySection.classList.remove('hidden');
}

// Set predefined question
function setQuestion(question) {
    document.getElementById('question-input').value = question;
    document.getElementById('question-input').focus();
}

// Clear chat history
function clearHistory() {
    chatHistory = [];
    updateChatHistoryDisplay();
    showNotification('Chat history cleared', 'info');
}

// Download transcript
function downloadTranscript() {
    if (!currentTranscript) {
        showNotification('No transcript to download', 'error');
        return;
    }
    
    const blob = new Blob([currentTranscript], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript_${currentVideoId || 'youtube'}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    showNotification('Transcript downloaded!', 'success');
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${getNotificationClass(type)}`;
    notification.innerHTML = `
        <div class="flex items-center">
            <i class="fas ${getNotificationIcon(type)} mr-2"></i>
            <span>${message}</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-white hover:text-gray-200">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}

// Get notification styling based on type
function getNotificationClass(type) {
    switch (type) {
        case 'success':
            return 'bg-green-600 text-white';
        case 'error':
            return 'bg-red-600 text-white';
        case 'warning':
            return 'bg-yellow-600 text-white';
        default:
            return 'bg-blue-600 text-white';
    }
}

// Get notification icon based on type
function getNotificationIcon(type) {
    switch (type) {
        case 'success':
            return 'fa-check-circle';
        case 'error':
            return 'fa-exclamation-circle';
        case 'warning':
            return 'fa-exclamation-triangle';
        default:
            return 'fa-info-circle';
    }
}
