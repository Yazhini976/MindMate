// mentor.js - Enhanced with backend integration

// DOM Elements
const chatWindow = document.getElementById('chatWindow');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const themeToggle = document.getElementById('themeToggle');
const mentorSelectBtn = document.getElementById('mentorSelectBtn');
const mentorModal = document.getElementById('mentorModal');
const mentorGrid = document.getElementById('mentorGrid');
const mentorAvatar = document.getElementById('mentorAvatar');
const mentorName = document.getElementById('mentorName');
const mentorSpecialty = document.getElementById('mentorSpecialty');

// State
let selectedMentor = null;
let sessionId = generateSessionId();
let socket = null;
let mentors = [];

// Initialize Socket.IO connection
function initializeSocket() {
  const serverUrl = window.location.origin;
  socket = io(serverUrl);
  
  socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('join-session', sessionId);
  });

  socket.on('new-message', (message) => {
    if (message.type === 'mentor') {
      addMessage(message.content, 'mentor', message.mentor);
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });
}

// Generate unique session ID
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Load mentors from API
async function loadMentors() {
  try {
    const response = await fetch('/api/mentors');
    mentors = await response.json();
    renderMentorGrid();
  } catch (error) {
    console.error('Error loading mentors:', error);
    // Fallback mentors
    mentors = [
      {
        id: 'tech-mentor',
        name: 'Tech Mentor',
        specialty: 'Programming & Development',
        avatar: '💻',
        description: 'Expert in software development, algorithms, and modern technologies.'
      },
      {
        id: 'career-mentor',
        name: 'Career Mentor',
        specialty: 'Career Guidance',
        avatar: '🎯',
        description: 'Specializes in career planning, resume building, and job search strategies.'
      }
    ];
    renderMentorGrid();
  }
}

// Render mentor selection grid
function renderMentorGrid() {
  mentorGrid.innerHTML = '';
  
  mentors.forEach(mentor => {
    const mentorCard = document.createElement('div');
    mentorCard.className = 'col-md-6 mb-3';
    mentorCard.innerHTML = `
      <div class="mentor-card card h-100 cursor-pointer" data-mentor-id="${mentor.id}">
        <div class="card-body text-center">
          <div class="mentor-avatar-large mb-3">${mentor.avatar}</div>
          <h6 class="card-title">${mentor.name}</h6>
          <p class="card-text text-muted small">${mentor.specialty}</p>
          <p class="card-text small">${mentor.description}</p>
        </div>
      </div>
    `;
    
    mentorCard.addEventListener('click', () => selectMentor(mentor));
    mentorGrid.appendChild(mentorCard);
  });
}

// Select a mentor
function selectMentor(mentor) {
  selectedMentor = mentor;
  
  // Update UI
  mentorAvatar.textContent = mentor.avatar;
  mentorName.textContent = mentor.name;
  mentorSpecialty.textContent = mentor.specialty;
  
  // Close modal
  const modal = bootstrap.Modal.getInstance(mentorModal);
  modal.hide();
  
  // Add welcome message
  addMessage(`Hello! I'm ${mentor.name}, your ${mentor.specialty} mentor. How can I help you today?`, 'mentor', mentor);
  
  // Enable chat input
  chatInput.disabled = false;
  chatInput.placeholder = `Ask ${mentor.name} anything...`;
}

// Add message to chat
function addMessage(text, sender, mentor = null) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message', sender);
  
  // Add mentor info if available
  if (sender === 'mentor' && mentor) {
    msgDiv.innerHTML = `
      <div class="message-header">
        <span class="mentor-avatar-small">${mentor.avatar}</span>
        <span class="mentor-name">${mentor.name}</span>
      </div>
      <div class="message-content">${text}</div>
    `;
  } else {
    msgDiv.textContent = text;
  }
  
  chatWindow.appendChild(msgDiv);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  
  // Add typing animation for mentor messages
  if (sender === 'mentor') {
    msgDiv.style.opacity = '0';
    setTimeout(() => {
      msgDiv.style.opacity = '1';
    }, 100);
  }
}

// Send message to backend
async function sendMessage(message) {
  if (!selectedMentor) {
    addMessage('Please select a mentor first!', 'mentor');
    return;
  }

  try {
    // Send via Socket.IO for real-time experience
    socket.emit('send-message', {
      message: message,
      sessionId: sessionId,
      mentorId: selectedMentor.id
    });
    
    // Also send via REST API as backup
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: message,
        sessionId: sessionId,
        mentorId: selectedMentor.id
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    
  } catch (error) {
    console.error('Error sending message:', error);
    addMessage('Sorry, I encountered an error. Please try again.', 'mentor');
  }
}

// Event Listeners
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  // Add user message to chat
  addMessage(message, 'user');
  chatInput.value = '';
  chatInput.disabled = true;

  // Send message to backend
  await sendMessage(message);

  // Re-enable input after a short delay
  setTimeout(() => {
    chatInput.disabled = false;
    chatInput.focus();
  }, 1000);
});

// Mentor selection button
mentorSelectBtn.addEventListener('click', () => {
  const modal = new bootstrap.Modal(mentorModal);
  modal.show();
});

// Theme toggle
function toggleTheme() {
  document.body.classList.toggle('dark-theme');
  themeToggle.textContent = document.body.classList.contains('dark-theme') ? '☀️' : '🌙';
}

themeToggle.addEventListener('click', toggleTheme);

// Initialize theme button text
themeToggle.textContent = '🌙';

// Initialize the application
async function init() {
  // Initialize Socket.IO
  initializeSocket();
  
  // Load mentors
  await loadMentors();
  
  // Add initial welcome message
  addMessage('Welcome! Please select a mentor to start chatting.', 'mentor');
  
  // Disable chat input until mentor is selected
  chatInput.disabled = true;
  chatInput.placeholder = 'Select a mentor to start chatting...';
}

// Start the application
init();
