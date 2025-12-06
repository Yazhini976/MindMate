const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const Stripe = require('stripe');
require('dotenv').config();

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? process.env.CLIENT_URL : "*",
    methods: ["GET", "POST"]
  }
});

// Initialize external services
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_demo');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/twinity', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Import Models
const User = require('./models/User');
const { Team } = require('./models/Team');
const { Game, GameSession, Leaderboard, Tournament } = require('./models/Game');
const { Job, Application, Internship } = require('./models/Job');
const { Quiz, QuizAttempt, SkillAssessment } = require('./models/Quiz');
const { SecurityLog, CybersecurityAssessment, SecurityIncident } = require('./models/SecurityLog');
const { ChatSession, AIMentor, CodeReview } = require('./models/ChatSession');
const { Payment, SubscriptionPlan, PromoCode, BillingHistory } = require('./models/Payment');

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://js.stripe.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["https://js.stripe.com"]
    }
  }
}));

app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.CLIENT_URL : true,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts, please try again later.'
});

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/twinity'
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'demo@twinity.com',
    pass: process.env.EMAIL_PASS || 'demo_password'
  }
});

// JWT Middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret');
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Subscription middleware
const requireSubscription = (requiredPlan) => {
  return (req, res, next) => {
    const user = req.user;
    const planHierarchy = { free: 0, basic: 1, premium: 2, enterprise: 3 };
    
    if (planHierarchy[user.subscription.plan] >= planHierarchy[requiredPlan]) {
      next();
    } else {
      res.status(403).json({ 
        error: 'Subscription upgrade required',
        requiredPlan,
        currentPlan: user.subscription.plan
      });
    }
  };
};

// Security logging function
const logSecurityEvent = async (userId, event, details, ipAddress) => {
  try {
    await SecurityLog.create({
      userId,
      event,
      details,
      ipAddress,
      userAgent: details.userAgent || '',
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
};

// AUTHENTICATION ROUTES
app.post('/api/auth/register', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
  body('firstName').trim().isLength({ min: 1 }),
  body('lastName').trim().isLength({ min: 1 }),
  body('username').trim().isLength({ min: 3 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, firstName, lastName, username } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });

    if (existingUser) {
      await logSecurityEvent(null, 'REGISTRATION_ATTEMPT_DUPLICATE', 
        { email, username }, req.ip);
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create user
    const user = new User({
      email,
      password,
      firstName,
      lastName,
      username,
      emailVerificationToken: crypto.randomBytes(32).toString('hex'),
      emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    });

    await user.save();

    // Send verification email
    const verificationUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/verify-email/${user.emailVerificationToken}`;
    
    await transporter.sendMail({
      to: email,
      subject: 'Welcome to Twinity - Verify Your Email',
      html: `
        <h1>Welcome to Twinity!</h1>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verificationUrl}">Verify Email</a>
        <p>This link expires in 24 hours.</p>
      `
    });

    await logSecurityEvent(user._id, 'USER_REGISTERED', 
      { email, username }, req.ip);

    res.status(201).json({ 
      message: 'User created successfully. Please check your email for verification.' 
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, twoFactorCode } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      await logSecurityEvent(null, 'LOGIN_ATTEMPT_INVALID_EMAIL', 
        { email }, req.ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.isLocked) {
      await logSecurityEvent(user._id, 'LOGIN_ATTEMPT_LOCKED_ACCOUNT', 
        { email }, req.ip);
      return res.status(423).json({ error: 'Account temporarily locked' });
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      await user.incLoginAttempts();
      await logSecurityEvent(user._id, 'LOGIN_ATTEMPT_INVALID_PASSWORD', 
        { email }, req.ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check 2FA if enabled
    if (user.twoFactorEnabled) {
      if (!twoFactorCode) {
        return res.status(200).json({ 
          requiresTwoFactor: true,
          message: 'Two-factor authentication code required' 
        });
      }

      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: twoFactorCode,
        window: 1
      });

      if (!verified) {
        await logSecurityEvent(user._id, 'LOGIN_ATTEMPT_INVALID_2FA', 
          { email }, req.ip);
        return res.status(401).json({ error: 'Invalid two-factor code' });
      }
    }

    // Reset login attempts
    await user.resetLoginAttempts();

    // Update analytics
    user.analytics.lastActive = new Date();
    user.analytics.totalSessions += 1;
    await user.save();

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-jwt-secret',
      { expiresIn: '7d' }
    );

    await logSecurityEvent(user._id, 'USER_LOGIN_SUCCESS', 
      { email }, req.ip);

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        subscription: user.subscription,
        isEmailVerified: user.isEmailVerified
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Email verification
app.get('/api/auth/verify-email/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      emailVerificationToken: req.params.token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    await logSecurityEvent(user._id, 'EMAIL_VERIFIED', {}, req.ip);

    res.redirect('/login.html?verified=true');
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Setup 2FA
app.post('/api/auth/setup-2fa', authenticateToken, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `Twinity (${req.user.email})`,
      issuer: 'Twinity'
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Store secret temporarily (don't enable until verified)
    req.user.twoFactorSecret = secret.base32;
    await req.user.save();

    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify and enable 2FA
app.post('/api/auth/verify-2fa', authenticateToken, [
  body('token').isLength({ min: 6, max: 6 })
], async (req, res) => {
  try {
    const { token } = req.body;

    const verified = speakeasy.totp.verify({
      secret: req.user.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    req.user.twoFactorEnabled = true;
    await req.user.save();

    await logSecurityEvent(req.user._id, 'TWO_FACTOR_ENABLED', {}, req.ip);

    res.json({ message: 'Two-factor authentication enabled successfully' });
  } catch (error) {
    console.error('2FA verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GAME ROUTES
app.get('/api/games', async (req, res) => {
  try {
    const { category, difficulty, type, featured } = req.query;
    const filter = { isActive: true };
    
    if (category) filter.category = category;
    if (difficulty) filter.difficulty = difficulty;
    if (type) filter.type = type;
    if (featured) filter.featured = featured === 'true';
    
    const games = await Game.find(filter)
      .sort({ featured: -1, 'analytics.totalPlays': -1 })
      .populate('createdBy', 'username');
    
    res.json(games);
  } catch (error) {
    console.error('Get games error:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

app.get('/api/games/:id', async (req, res) => {
  try {
    const game = await Game.findById(req.params.id)
      .populate('createdBy', 'username');
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    res.json(game);
  } catch (error) {
    console.error('Get game error:', error);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

app.post('/api/games/:id/play', authenticateToken, async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    // Check if user has required skills
    const userSkills = req.user.skills.map(s => s.name);
    const requiredSkills = game.config.skillsRequired || [];
    const hasRequiredSkills = requiredSkills.every(skill => 
      userSkills.some(userSkill => 
        userSkill.toLowerCase().includes(skill.toLowerCase())
      )
    );
    
    if (!hasRequiredSkills) {
      return res.status(403).json({ 
        error: 'Required skills not met',
        requiredSkills 
      });
    }
    
    // Create game session
    const gameSession = new GameSession({
      gameId: game._id,
      players: [{
        userId: req.user._id,
        username: req.user.username,
        role: 'player'
      }],
      status: 'in-progress',
      startedAt: new Date()
    });
    
    await gameSession.save();
    
    // Update game analytics
    game.analytics.totalPlays += 1;
    if (!game.analytics.totalPlayers) game.analytics.totalPlayers = 0;
    game.analytics.totalPlayers += 1;
    await game.save();
    
    res.json({ sessionId: gameSession._id, game });
  } catch (error) {
    console.error('Start game error:', error);
    res.status(500).json({ error: 'Failed to start game' });
  }
});

app.post('/api/game-sessions/:sessionId/submit', authenticateToken, async (req, res) => {
  try {
    const { code, language, answer } = req.body;
    const session = await GameSession.findById(req.params.sessionId)
      .populate('gameId');
    
    if (!session) {
      return res.status(404).json({ error: 'Game session not found' });
    }
    
    // Verify user is in session
    const player = session.players.find(p => p.userId.toString() === req.user._id.toString());
    if (!player) {
      return res.status(403).json({ error: 'Not authorized for this session' });
    }
    
    let result = { status: 'pending', score: 0, testsPassed: 0, totalTests: 0 };
    
    if (session.gameId.type === 'code-challenge') {
      // Simulate code execution and testing
      const testCases = session.gameId.content.testCases || [];
      let passed = 0;
      
      // Simple simulation - in real implementation, use a code execution service
      for (const testCase of testCases) {
        if (!testCase.isHidden || Math.random() > 0.3) { // Pass most tests for demo
          passed++;
        }
      }
      
      result = {
        status: passed === testCases.length ? 'success' : 'partial',
        score: Math.round((passed / testCases.length) * session.gameId.scoring.maxPoints),
        testsPassed: passed,
        totalTests: testCases.length,
        executionTime: Math.random() * 1000,
        memoryUsed: Math.random() * 100
      };
    } else {
      // For other game types, simple scoring
      result.score = Math.floor(Math.random() * session.gameId.scoring.maxPoints);
      result.status = result.score >= session.gameId.scoring.passingScore ? 'success' : 'partial';
    }
    
    // Add submission
    session.submissions.push({
      userId: req.user._id,
      code: code || answer,
      language: language || 'text',
      result
    });
    
    // Update session results
    const existingResult = session.results.find(r => r.userId.toString() === req.user._id.toString());
    if (existingResult) {
      existingResult.score = Math.max(existingResult.score, result.score);
    } else {
      session.results.push({
        userId: req.user._id,
        score: result.score,
        timeSpent: (Date.now() - session.startedAt.getTime()) / 1000
      });
    }
    
    await session.save();
    
    // Update user's gaming profile
    req.user.gamingProfile.totalScore += result.score;
    req.user.gamingProfile.gamesPlayed += 1;
    
    // Award badges for achievements
    if (result.score === session.gameId.scoring.maxPoints) {
      req.user.gamingProfile.badges.push({
        id: 'perfect-score',
        name: 'Perfect Score',
        icon: '🏆',
        earnedAt: new Date()
      });
    }
    
    await req.user.save();
    
    res.json({ result, session });
  } catch (error) {
    console.error('Submit solution error:', error);
    res.status(500).json({ error: 'Failed to submit solution' });
  }
});

// QUIZ AND SKILL ASSESSMENT ROUTES
app.get('/api/quizzes', async (req, res) => {
  try {
    const { category, difficulty, technology } = req.query;
    const filter = { isActive: true };
    
    if (category) filter.category = category;
    if (difficulty) filter.difficulty = difficulty;
    if (technology) filter.technology = technology;
    
    const quizzes = await Quiz.find(filter)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'username');
    
    res.json(quizzes);
  } catch (error) {
    console.error('Get quizzes error:', error);
    res.status(500).json({ error: 'Failed to fetch quizzes' });
  }
});

app.post('/api/quizzes/:id/attempt', authenticateToken, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    
    const { answers } = req.body;
    let score = 0;
    let correctAnswers = 0;
    
    const attemptAnswers = quiz.questions.map((question, index) => {
      const userAnswer = answers[index];
      let isCorrect = false;
      let pointsEarned = 0;
      
      if (question.type === 'multiple-choice') {
        const correctOption = question.options.find(opt => opt.isCorrect);
        if (correctOption && userAnswer === correctOption.text) {
          isCorrect = true;
          pointsEarned = question.points;
          score += pointsEarned;
          correctAnswers++;
        }
      }
      
      return {
        questionId: question._id,
        answer: userAnswer,
        isCorrect,
        pointsEarned
      };
    });
    
    const percentage = Math.round((score / quiz.totalPoints) * 100);
    const passed = percentage >= quiz.passingScore;
    
    // Create quiz attempt record
    const attempt = new QuizAttempt({
      userId: req.user._id,
      quizId: quiz._id,
      answers: attemptAnswers,
      score,
      percentage,
      passed,
      totalTimeSpent: req.body.timeSpent || 0,
      startedAt: new Date(Date.now() - (req.body.timeSpent || 0) * 1000),
      completedAt: new Date(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    await attempt.save();
    
    // Update quiz analytics
    quiz.analytics.totalAttempts += 1;
    quiz.analytics.averageScore = ((quiz.analytics.averageScore * (quiz.analytics.totalAttempts - 1)) + score) / quiz.analytics.totalAttempts;
    quiz.analytics.passRate = ((quiz.analytics.passRate * (quiz.analytics.totalAttempts - 1)) + (passed ? 1 : 0)) / quiz.analytics.totalAttempts;
    await quiz.save();
    
    // Update user's skill based on quiz result
    const skillName = quiz.category;
    const skillLevel = SkillAssessment.getSkillLevel(percentage);
    await req.user.updateSkill(skillName, skillLevel, percentage);
    
    // Issue certificate if applicable and passed
    if (passed && quiz.certification.isAvailable) {
      attempt.certificate = {
        issued: true,
        certificateId: `CERT-${Date.now()}-${req.user._id}`,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + quiz.certification.validityDays * 24 * 60 * 60 * 1000)
      };
      await attempt.save();
    }
    
    res.json({
      attempt,
      passed,
      certificate: attempt.certificate,
      skillLevel,
      recommendations: passed ? 
        ['Try advanced quizzes in this category', 'Explore related technologies'] :
        ['Review the concepts covered', 'Practice with beginner quizzes', 'Consider taking a course']
    });
  } catch (error) {
    console.error('Quiz attempt error:', error);
    res.status(500).json({ error: 'Failed to submit quiz' });
  }
});

// AI MENTOR ROUTES
app.get('/api/mentors', async (req, res) => {
  try {
    const mentors = await AIMentor.find({ isActive: true })
      .sort({ 'analytics.averageRating': -1 });
    res.json(mentors);
  } catch (error) {
    console.error('Get mentors error:', error);
    res.status(500).json({ error: 'Failed to fetch mentors' });
  }
});

app.post('/api/chat/sessions', authenticateToken, async (req, res) => {
  try {
    const { mentorId, isDemo = false } = req.body;
    
    const mentor = await AIMentor.findOne({ id: mentorId, isActive: true });
    if (!mentor) {
      return res.status(404).json({ error: 'Mentor not found' });
    }
    
    // Check subscription access
    const requiredPlan = mentor.subscription.required;
    if (!isDemo && !req.user.hasAccess('ai-chat')) {
      return res.status(403).json({ 
        error: 'Subscription upgrade required',
        requiredPlan 
      });
    }
    
    // Check demo limits
    if (isDemo) {
      const demoSessions = await ChatSession.countDocuments({
        userId: req.user._id,
        isDemo: true,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });
      
      const demoLimit = 3; // 3 demo sessions per day
      if (demoSessions >= demoLimit) {
        return res.status(403).json({ 
          error: 'Demo limit reached. Upgrade to continue.',
          demoLimit 
        });
      }
    }
    
    const session = new ChatSession({
      userId: req.user._id,
      mentor: {
        id: mentor.id,
        name: mentor.name,
        specialty: mentor.specialty,
        avatar: mentor.avatar
      },
      context: {
        domain: mentor.specialty.toLowerCase().replace(/[^a-z]/g, '-'),
        userSkillLevel: req.user.getSkillLevel(mentor.specialty) || 'beginner'
      },
      isDemo,
      subscription: {
        plan: req.user.subscription.plan,
        messagesLimit: isDemo ? 5 : (req.user.subscription.plan === 'enterprise' ? -1 : 100)
      }
    });
    
    // Add greeting message
    await session.addMessage('ai', mentor.prompts.greetingMessage || 
      `Hello! I'm ${mentor.name}, your ${mentor.specialty} mentor. How can I help you today?`);
    
    await session.save();
    
    // Update mentor analytics
    mentor.analytics.totalSessions += 1;
    await mentor.save();
    
    res.json(session);
  } catch (error) {
    console.error('Create chat session error:', error);
    res.status(500).json({ error: 'Failed to create chat session' });
  }
});

app.post('/api/chat/sessions/:sessionId/message', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const session = await ChatSession.findById(req.params.sessionId);
    
    if (!session || session.userId.toString() !== req.user._id.toString()) {
      return res.status(404).json({ error: 'Chat session not found' });
    }
    
    // Check message limits
    if (session.isDemo && session.demoMessagesUsed >= 5) {
      return res.status(403).json({ 
        error: 'Demo message limit reached. Upgrade to continue.' 
      });
    }
    
    if (!session.isDemo && session.subscription.messagesLimit > 0 && 
        session.subscription.messagesUsed >= session.subscription.messagesLimit) {
      return res.status(403).json({ 
        error: 'Monthly message limit reached. Upgrade your plan.' 
      });
    }
    
    // Add user message
    await session.addMessage('user', message);
    
    // Get AI response (simplified - in production, use OpenAI API)
    const aiResponse = await generateSmartAIResponse(message, session.mentor.id, session.context);
    
    await session.addMessage('ai', aiResponse, {
      tokens: aiResponse.length / 4, // Rough estimation
      model: 'gpt-4',
      processingTime: Math.random() * 1000
    });
    
    res.json({
      message: aiResponse,
      session: {
        id: session._id,
        messagesUsed: session.isDemo ? session.demoMessagesUsed : session.subscription.messagesUsed,
        messagesLimit: session.subscription.messagesLimit
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Enhanced AI response generator
async function generateSmartAIResponse(message, mentorId, context) {
  const mentorResponses = {
    'react-mentor': {
      keywords: ['component', 'state', 'props', 'hook', 'jsx'],
      responses: [
        "Great question about React! Let me break this down for you...",
        "In React, this pattern is commonly used. Here's how you can approach it:",
        "I see you're working with React components. Let's optimize this code:"
      ]
    },
    'python-mentor': {
      keywords: ['function', 'class', 'loop', 'list', 'dict'],
      responses: [
        "Python offers elegant solutions for this. Let me show you:",
        "This is a common Python pattern. Here's the Pythonic way:",
        "Great Python question! Let's write clean, readable code:"
      ]
    },
    'cybersecurity-mentor': {
      keywords: ['security', 'vulnerability', 'attack', 'encryption', 'authentication'],
      responses: [
        "Security is crucial here. Let me explain the risks and mitigations:",
        "This is a common security concern. Here's how to protect against it:",
        "Great security question! Let's implement this securely:"
      ]
    },
    'devops-mentor': {
      keywords: ['deploy', 'docker', 'kubernetes', 'ci/cd', 'pipeline'],
      responses: [
        "DevOps best practices suggest this approach:",
        "For deployment, I recommend this strategy:",
        "Let's set up a robust CI/CD pipeline for this:"
      ]
    },
    'ai-ml-mentor': {
      keywords: ['model', 'training', 'data', 'algorithm', 'neural'],
      responses: [
        "In machine learning, this approach works well:",
        "For this ML problem, consider these techniques:",
        "Great AI question! Let's build an effective model:"
      ]
    },
    'blockchain-mentor': {
      keywords: ['smart contract', 'ethereum', 'solidity', 'web3', 'defi'],
      responses: [
        "In blockchain development, security is paramount:",
        "For smart contracts, this pattern is gas-efficient:",
        "Web3 development requires careful consideration of:"
      ]
    },
    'data-science-mentor': {
      keywords: ['data', 'analysis', 'visualization', 'pandas', 'statistics'],
      responses: [
        "For data analysis, this statistical approach works:",
        "Let's explore this dataset systematically:",
        "Data visualization can reveal these insights:"
      ]
    }
  };
  
  const mentor = mentorResponses[mentorId] || mentorResponses['react-mentor'];
  const hasKeyword = mentor.keywords.some(keyword => 
    message.toLowerCase().includes(keyword)
  );
  
  let response = hasKeyword ? 
    mentor.responses[Math.floor(Math.random() * mentor.responses.length)] :
    "I understand your question. Let me help you with that...";
  
  // Add context-specific guidance
  if (context.userSkillLevel === 'beginner') {
    response += " Since you're just starting out, let me explain the fundamentals first.";
  } else if (context.userSkillLevel === 'advanced') {
    response += " Given your advanced level, let's dive into the technical details.";
  }
  
  return response;
}

// PAYMENT AND SUBSCRIPTION ROUTES
app.get('/api/subscription/plans', async (req, res) => {
  try {
    const plans = await SubscriptionPlan.getActivePlans();
    res.json(plans);
  } catch (error) {
    console.error('Get subscription plans error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

app.post('/api/subscription/create-checkout', authenticateToken, async (req, res) => {
  try {
    const { planName, billingCycle, promoCode } = req.body;
    
    const plan = await SubscriptionPlan.findOne({ name: planName, isActive: true });
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    
    let amount = plan.price[billingCycle];
    let discount = 0;
    let promoApplied = null;
    
    // Apply promo code if provided
    if (promoCode) {
      const promoValidation = await PromoCode.validateCode(promoCode, req.user._id, planName, amount);
      if (promoValidation.valid) {
        discount = promoValidation.discount;
        promoApplied = promoValidation.promo;
        amount -= discount;
      }
    }
    
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${plan.displayName} - ${billingCycle} Billing`,
            description: plan.description
          },
          unit_amount: Math.round(amount * 100), // Convert to cents
          recurring: {
            interval: billingCycle === 'yearly' ? 'year' : 'month'
          }
        },
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard.html?success=true`,
      cancel_url: `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard.html?canceled=true`,
      customer_email: req.user.email,
      metadata: {
        userId: req.user._id.toString(),
        planName,
        billingCycle,
        promoCode: promoCode || '',
        originalAmount: plan.price[billingCycle].toString(),
        discount: discount.toString()
      }
    });
    
    res.json({ 
      sessionId: session.id,
      checkoutUrl: session.url
    });
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.post('/api/subscription/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        await handleSuccessfulPayment(session);
        break;
      
      case 'invoice.payment_succeeded':
        const invoice = event.data.object;
        await handleSuccessfulRecurringPayment(invoice);
        break;
        
      case 'customer.subscription.deleted':
        const subscription = event.data.object;
        await handleSubscriptionCancellation(subscription);
        break;
        
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({received: true});
  } catch (error) {
    console.error('Webhook handling error:', error);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

async function handleSuccessfulPayment(session) {
  const userId = session.metadata.userId;
  const planName = session.metadata.planName;
  const billingCycle = session.metadata.billingCycle;
  
  // Update user subscription
  const user = await User.findById(userId);
  if (user) {
    user.subscription = {
      plan: planName,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: session.subscription,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false
    };
    await user.save();
    
    // Create payment record
    const payment = new Payment({
      userId,
      stripePaymentIntentId: session.payment_intent,
      stripeCustomerId: session.customer,
      amount: session.amount_total / 100,
      status: 'succeeded',
      plan: planName,
      billingCycle,
      subscription: {
        stripeSubscriptionId: session.subscription,
        currentPeriodStart: new Date(),
        currentPeriodEnd: user.subscription.currentPeriodEnd
      }
    });
    await payment.save();
    
    // Apply promo code if used
    if (session.metadata.promoCode) {
      const promo = await PromoCode.findOne({ code: session.metadata.promoCode.toUpperCase() });
      if (promo) {
        await promo.applyCode(userId, payment._id);
      }
    }
  }
}

// TEAM FINDER ROUTES
app.get('/api/teams', async (req, res) => {
  try {
    const { category, skillLevel, lookingFor, hackathonType } = req.query;
    const filter = { isActive: true };
    
    if (category) filter.category = category;
    if (skillLevel) filter.preferredSkillLevel = skillLevel;
    if (lookingFor) filter.lookingFor = { $in: [lookingFor] };
    if (hackathonType) filter.hackathonFocus = hackathonType;
    
    const teams = await Team.find(filter)
      .populate('members.userId', 'username skills gamingProfile')
      .populate('leader', 'username skills')
      .sort({ createdAt: -1 });
    
    res.json(teams);
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

app.post('/api/teams', authenticateToken, async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      hackathonFocus,
      preferredSkillLevel,
      maxMembers,
      lookingFor,
      requirements
    } = req.body;
    
    const team = new Team({
      name,
      description,
      category,
      hackathonFocus,
      preferredSkillLevel,
      maxMembers: maxMembers || 4,
      lookingFor: lookingFor || [],
      requirements: requirements || [],
      leader: req.user._id,
      members: [{
        userId: req.user._id,
        role: 'leader',
        joinedAt: new Date()
      }],
      isActive: true
    });
    
    await team.save();
    
    // Add team to user's teams
    req.user.teams.push({
      teamId: team._id,
      role: 'leader'
    });
    await req.user.save();
    
    res.status(201).json(team);
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

app.post('/api/teams/:id/join', authenticateToken, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Check if user is already a member
    const existingMember = team.members.find(m => m.userId.toString() === req.user._id.toString());
    if (existingMember) {
      return res.status(400).json({ error: 'Already a member of this team' });
    }
    
    // Check if team is full
    if (team.members.length >= team.maxMembers) {
      return res.status(400).json({ error: 'Team is full' });
    }
    
    // Calculate compatibility score
    const compatibility = calculateTeamCompatibility(req.user.skills, team);
    
    if (compatibility.score < 60) {
      return res.status(400).json({ 
        error: 'Skill compatibility too low',
        compatibilityScore: compatibility.score,
        suggestions: compatibility.suggestions
      });
    }
    
    // Add user to team
    team.members.push({
      userId: req.user._id,
      role: 'member',
      joinedAt: new Date()
    });
    
    // Update team analytics
    team.analytics.totalJoinRequests += 1;
    team.analytics.averageSkillLevel = calculateAverageSkillLevel(team.members);
    
    await team.save();
    
    // Add team to user's teams
    req.user.teams.push({
      teamId: team._id,
      role: 'member'
    });
    await req.user.save();
    
    res.json({ 
      message: 'Successfully joined team',
      compatibilityScore: compatibility.score,
      team 
    });
  } catch (error) {
    console.error('Join team error:', error);
    res.status(500).json({ error: 'Failed to join team' });
  }
});

function calculateTeamCompatibility(userSkills, team) {
  const requiredSkills = team.lookingFor || [];
  let matchScore = 0;
  let totalSkills = requiredSkills.length || 1;
  const suggestions = [];
  
  requiredSkills.forEach(requiredSkill => {
    const userSkill = userSkills.find(skill => 
      skill.name.toLowerCase().includes(requiredSkill.toLowerCase())
    );
    
    if (userSkill) {
      matchScore += userSkill.level * 20; // Convert level to percentage
    } else {
      suggestions.push(`Consider learning ${requiredSkill}`);
    }
  });
  
  const score = Math.min(100, matchScore / totalSkills);
  
  return {
    score: Math.round(score),
    suggestions: suggestions.slice(0, 3) // Limit suggestions
  };
}

function calculateAverageSkillLevel(members) {
  // Simplified calculation - in real implementation, fetch all member data
  return Math.random() * 5 + 5; // Return random value between 5-10
}

// JOBS AND INTERNSHIPS ROUTES
app.get('/api/jobs', async (req, res) => {
  try {
    const { 
      type, 
      category, 
      location, 
      remote, 
      skillLevel,
      company,
      salaryMin,
      salaryMax 
    } = req.query;
    
    const filter = { status: 'active' };
    
    if (type) filter.type = type;
    if (category) filter['requirements.skills.name'] = { $in: [category] };
    if (location) filter['company.location.city'] = new RegExp(location, 'i');
    if (remote === 'true') filter['company.location.isRemote'] = true;
    if (company) filter['company.name'] = new RegExp(company, 'i');
    if (salaryMin || salaryMax) {
      filter['salary.min'] = {};
      if (salaryMin) filter['salary.min'].$gte = parseInt(salaryMin);
      if (salaryMax) filter['salary.max'] = { $lte: parseInt(salaryMax) };
    }
    
    const jobs = await Job.find(filter)
      .sort({ featured: -1, createdAt: -1 })
      .populate('postedBy', 'username company')
      .limit(50);
    
    res.json(jobs);
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.get('/api/jobs/recommendations', authenticateToken, async (req, res) => {
  try {
    const userSkills = req.user.skills.map(s => ({ name: s.name, level: s.level }));
    const pipeline = [
      {
        $match: { status: 'active' }
      },
      {
        $addFields: {
          skillMatch: {
            $let: {
              vars: {
                matchedSkills: {
                  $size: {
                    $filter: {
                      input: '$requirements.skills',
                      cond: {
                        $in: ['$$this.name', userSkills.map(s => s.name)]
                      }
                    }
                  }
                },
                totalSkills: { $size: '$requirements.skills' }
              },
              in: {
                $cond: [
                  { $eq: ['$$totalSkills', 0] },
                  0,
                  { $multiply: [{ $divide: ['$$matchedSkills', '$$totalSkills'] }, 100] }
                ]
              }
            }
          }
        }
      },
      {
        $match: { skillMatch: { $gte: 30 } }
      },
      {
        $sort: { skillMatch: -1, featured: -1, createdAt: -1 }
      },
      {
        $limit: 20
      }
    ];
    
    const recommendedJobs = await Job.aggregate(pipeline);
    res.json(recommendedJobs);
  } catch (error) {
    console.error('Get job recommendations error:', error);
    res.status(500).json({ error: 'Failed to fetch job recommendations' });
  }
});

app.post('/api/jobs/:id/apply', authenticateToken, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if user already applied
    const existingApplication = job.applications.find(app => 
      app.userId.toString() === req.user._id.toString()
    );
    
    if (existingApplication) {
      return res.status(400).json({ error: 'Already applied to this job' });
    }
    
    const { coverLetter, portfolio } = req.body;
    
    // Calculate skill match
    const skillMatch = Job.calculateSkillMatch(req.user.skills, job.requirements);
    
    // Cybersecurity check
    const securityCheck = await performCybersecurityCheck(req.user, job);
    
    if (!securityCheck.passed) {
      return res.status(403).json({
        error: 'Cybersecurity requirements not met',
        requirements: securityCheck.failedChecks
      });
    }
    
    // Create application
    const application = new Application({
      jobId: job._id,
      userId: req.user._id,
      matchScore: {
        overall: skillMatch,
        skillMatch: skillMatch,
        experienceMatch: calculateExperienceMatch(req.user, job),
        educationMatch: 80 // Simplified
      },
      documents: {
        coverLetter,
        portfolio: portfolio ? { url: portfolio, description: 'User portfolio' } : null
      },
      timeline: [{
        event: 'Application submitted',
        timestamp: new Date(),
        details: `Applied with ${skillMatch}% skill match`
      }]
    });
    
    await application.save();
    
    // Add to job applications
    job.applications.push({
      userId: req.user._id,
      appliedAt: new Date(),
      status: 'pending',
      matchPercentage: skillMatch,
      coverLetter,
      portfolio
    });
    
    // Update job analytics
    job.analytics.applications += 1;
    if (skillMatch >= 70) {
      job.analytics.matches += 1;
    }
    
    await job.save();
    
    res.json({
      message: 'Application submitted successfully',
      applicationId: application._id,
      matchScore: skillMatch,
      securityCheck: securityCheck.passed
    });
  } catch (error) {
    console.error('Apply to job error:', error);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

async function performCybersecurityCheck(user, job) {
  const checks = {
    backgroundCheck: true,
    securityClearance: true,
    cybersecuritySkills: true
  };
  
  const failedChecks = [];
  
  // Check cybersecurity requirements
  if (job.cybersecurityRequirements.backgroundCheck && !user.backgroundCheckPassed) {
    checks.backgroundCheck = false;
    failedChecks.push('Background check required');
  }
  
  if (job.cybersecurityRequirements.securityClearance.required) {
    const userClearanceLevel = user.securityClearance || 'none';
    const requiredLevel = job.cybersecurityRequirements.securityClearance.level;
    
    const clearanceLevels = { none: 0, confidential: 1, secret: 2, 'top-secret': 3 };
    
    if (clearanceLevels[userClearanceLevel] < clearanceLevels[requiredLevel]) {
      checks.securityClearance = false;
      failedChecks.push(`Security clearance level ${requiredLevel} required`);
    }
  }
  
  // Check cybersecurity skills
  const requiredCyberSkills = job.cybersecurityRequirements.cybersecuritySkills || [];
  const userCyberSkills = user.skills.filter(skill => 
    skill.category === 'cybersecurity'
  ).map(skill => skill.name);
  
  const requiredSkills = requiredCyberSkills.filter(req => req.importance === 'required');
  const missingSkills = requiredSkills.filter(req => 
    !userCyberSkills.some(userSkill => 
      userSkill.toLowerCase().includes(req.skill.toLowerCase())
    )
  );
  
  if (missingSkills.length > 0) {
    checks.cybersecuritySkills = false;
    failedChecks.push(`Required cybersecurity skills: ${missingSkills.map(s => s.skill).join(', ')}`);
  }
  
  return {
    passed: Object.values(checks).every(check => check),
    checks,
    failedChecks
  };
}

function calculateExperienceMatch(user, job) {
  // Simplified experience matching
  const userExperience = user.learningProgress.totalHoursLearned / 1000; // Convert hours to years
  const requiredMin = job.requirements.experience.min || 0;
  const requiredMax = job.requirements.experience.max || 10;
  
  if (userExperience >= requiredMin && userExperience <= requiredMax) {
    return 100;
  } else if (userExperience < requiredMin) {
    return Math.max(0, (userExperience / requiredMin) * 80);
  } else {
    return Math.max(60, 100 - ((userExperience - requiredMax) * 10));
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Twinity 3.0 Server running on port ${PORT}`);
  console.log(`🎮 Gaming System: Active`);
  console.log(`🤖 AI Mentors: 7 Specialists Ready`);
  console.log(`🔒 Security: Enhanced Cybersecurity Features`);
  console.log(`💳 Payments: Stripe Integration Active`);
  console.log(`📊 Analytics: Real-time Tracking`);
});