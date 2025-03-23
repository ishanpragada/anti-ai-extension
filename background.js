  const OPENAI_API_KEY = '';
  const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

  let state = {
    mode: "normal",
    studyingMode: true,
    assignmentMode: false,
    aiSites: [
      "chat.openai.com",
      "claude.ai",
      "gemini.google.com",
      "x.ai",
      "deepseek.ai",
      "copilot.microsoft.com"
    ],
    usage: {
      today: 0,
      week: 0,
      month: 0,
      history: {
        daily: [],
        weekly: [], 
        monthly: []
      },
      lastReset: {
        daily: new Date().toISOString(),
        weekly: new Date().toISOString(),
        monthly: new Date().toISOString()
      }
    },
    gamification: {
      dailyGoal: 5,
      currentStreak: 0,
      longestStreak: 0,
      lastGoalHit: null,
      level: 1,
      totalPoints: 0,
      achievements: [],
      dailyProgress: []
    },
    history: [],
    thinkingPoints: 0,
    lastPrompt: ""
  };
  
  chrome.storage.local.get('thinkFirstState', (data) => {
    if (data.thinkFirstState) {
      state = { ...state, ...data.thinkFirstState };
      checkAndResetCounters();
    } else {
      chrome.storage.local.set({ 'thinkFirstState': state });
    }
  });
  
  function updateState() {
    chrome.storage.local.set({ 'thinkFirstState': state });
  }
  
  function checkAndResetCounters() {
    const now = new Date();
    const lastDaily = new Date(state.usage.lastReset.daily);
    const lastWeekly = new Date(state.usage.lastReset.weekly);
    const lastMonthly = new Date(state.usage.lastReset.monthly);

    if (now.toDateString() !== lastDaily.toDateString()) {
      state.usage.today = 0;
      state.usage.lastReset.daily = now.toISOString();
    }

    const weekDiff = Math.floor((now - lastWeekly) / (1000 * 60 * 60 * 24 * 7));
    if (weekDiff >= 1) {
      state.usage.week = 0;
      state.usage.lastReset.weekly = now.toISOString();
    }

    if (now.getMonth() !== lastMonthly.getMonth() || now.getFullYear() !== lastMonthly.getFullYear()) {
      state.usage.month = 0;
      state.usage.lastReset.monthly = now.toISOString();
    }

    updateState();
  }
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case "getState":
        checkAndResetCounters();
        sendResponse({ state });
        break;
      
      case "setMode":
        state.mode = request.mode;
        updateState();
        sendResponse({ success: true });
        break;
      
      case "promptDetected":
        handlePrompt(request.promptText, request.site);
        sendResponse({ success: true });
        break;
      
      case "analyzePrompt":
        analyzePrompt(request.text).then(analysis => {
          sendResponse({ success: true, analysis });
        });
        return true;
      
      case "logThinking":
        handleThinkingPoints(request.points || 1);
        sendResponse({ success: true, thinkingPoints: state.thinkingPoints });
        break;

      case "setDailyGoal":
        state.gamification.dailyGoal = request.goal;
        updateState();
        sendResponse({ success: true });
        break;

      case "closeTab":
        if (sender.tab) {
          chrome.tabs.remove(sender.tab.id);
        }
        sendResponse({ success: true });
        break;

      case "reloadPage":
        if (sender.tab) {
          chrome.tabs.reload(sender.tab.id);
        }
        sendResponse({ success: true });
        break;
    }
    return false;
  });
  
  function handlePrompt(promptText, site) {
    checkAndResetCounters();
    
    state.usage.today++;
    state.usage.week++;
    state.usage.month++;
    
    const today = new Date().toISOString().split('T')[0];
    const thisWeek = getWeekNumber(new Date());
    const thisMonth = new Date().toISOString().slice(0, 7);
    
    let dailyEntry = state.usage.history.daily.find(d => d.date === today);
    if (dailyEntry) {
      dailyEntry.count++;
    } else {
      state.usage.history.daily.push({ date: today, count: 1 });
    }
    
    let weeklyEntry = state.usage.history.weekly.find(w => w.week === thisWeek);
    if (weeklyEntry) {
      weeklyEntry.count++;
    } else {
      state.usage.history.weekly.push({ week: thisWeek, count: 1 });
    }
    
    let monthlyEntry = state.usage.history.monthly.find(m => m.month === thisMonth);
    if (monthlyEntry) {
      monthlyEntry.count++;
    } else {
      state.usage.history.monthly.push({ month: thisMonth, count: 1 });
    }
    
    state.usage.history.daily = state.usage.history.daily.slice(-30);
    state.usage.history.weekly = state.usage.history.weekly.slice(-12);
    state.usage.history.monthly = state.usage.history.monthly.slice(-12);
    
    state.lastPrompt = promptText;
    
    state.history.push({
      prompt: promptText,
      site: site,
      timestamp: new Date().toISOString(),
      mode: state.mode
    });
    
    if (state.history.length > 100) {
      state.history = state.history.slice(-100);
    }
    
    updateState();
    
    if (state.mode !== "relaxed") {
      if (state.mode === "strict") {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "interventionRequired",
              type: "strict",
              prompt: promptText,
              reason: {
                isLazy: false,
                isLearning: false,
                reason: "You are in strict mode. All prompts require reflection before submission.",
                suggestedPrompt: null
              }
            });
          }
        });
      } else {
        analyzePrompt(promptText).then(result => {
          if (result.isLazy) {
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
              if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                  action: "interventionRequired",
                  type: "lazy",
                  prompt: promptText,
                  reason: {
                    ...result,
                    suggestedPrompt: result.suggestedPrompt,
                  }
                });
              }
            });
          }
        });
      }
    }
  }
  
  function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    const weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
    return d.getUTCFullYear() + '-W' + weekNo;
  }
  
  function handleThinkingPoints(points) {
    const newPoints = Math.max(0, state.thinkingPoints + points);
    const pointsToAdd = newPoints - state.thinkingPoints;
    
    state.thinkingPoints = newPoints;
    state.gamification.totalPoints = Math.max(0, state.gamification.totalPoints + pointsToAdd);
    
    const today = new Date().toISOString().split('T')[0];
    let dailyProgress = state.gamification.dailyProgress.find(d => d.date === today);
    if (dailyProgress) {
      dailyProgress.points = Math.max(0, dailyProgress.points + pointsToAdd);
    } else {
      state.gamification.dailyProgress.push({ date: today, points: Math.max(0, pointsToAdd) });
    }
    
    if (dailyProgress && dailyProgress.points >= state.gamification.dailyGoal) {
      const lastGoalDate = state.gamification.lastGoalHit ? 
        new Date(state.gamification.lastGoalHit).toISOString().split('T')[0] : null;
      
      if (lastGoalDate === yesterday()) {
        state.gamification.currentStreak++;
        state.gamification.longestStreak = Math.max(
          state.gamification.longestStreak,
          state.gamification.currentStreak
        );
      } else if (lastGoalDate !== today) {
        state.gamification.currentStreak = 1;
      }
      
      state.gamification.lastGoalHit = new Date().toISOString();
    }
    
    const newLevel = Math.floor(state.gamification.totalPoints / 100) + 1;
    if (newLevel > state.gamification.level) {
      state.gamification.level = newLevel;
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "levelUp",
            level: newLevel
          });
        }
      });
    }
    
    state.gamification.dailyProgress = state.gamification.dailyProgress.slice(-30);
    
    updateState();
  }
  
  function yesterday() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  }
  
  async function generateLearningPrompt(originalPrompt) {
    try {
      const response = await fetch(OPENAI_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `You are an AI tutor that helps students rephrase their questions to focus on learning and understanding.
              Your task is to convert "lazy" prompts that ask for direct solutions into learning-focused prompts that:
              1. Ask for explanations and understanding
              2. Show willingness to learn and engage with the material
              3. Request guidance rather than solutions
              4. Break down complex problems into smaller parts
              5. Focus on concepts and principles

              IMPORTANT: Keep the rephrased prompt around the same length or a little longer than the original prompt.
              
              For example:
              - "Write code to sort an array" -> "Can you explain the different sorting algorithms and help me understand which one would be most efficient for my use case? I'd like to implement it myself."
              - "Solve this math problem" -> "I'm stuck on this math problem. Could you help me understand the key concepts involved and guide me through the problem-solving approach?"
              
              Respond with a JSON object containing:
              {
                "learningPrompt": string (the rephrased learning-focused prompt),
              }`
            },
            {
              role: 'user',
              content: originalPrompt
            }
          ],
          temperature: 0.7,
          max_tokens: 200
        })
      });

      if (!response.ok) {
        console.error('OpenAI API error:', response.statusText);
        return null;
      }

      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (error) {
      console.error('Error generating learning prompt:', error);
      return null;
    }
  }

  async function analyzePrompt(promptText) {
    try {
      const response = await fetch(OPENAI_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `You are an AI usage analyzer that determines if a prompt represents "lazy" usage of AI or good learning behavior.
              
              VERY IMPORTANT - These are considered LAZY usage and should be flagged:
              1. Copy-pasted assignment/homework text (look for telltale signs like "TODO:", "The Problem", file descriptions, testing instructions)
              2. Direct requests for solutions without showing work/understanding
              3. Asking AI to write complete or fix code/essays ("Write a function," "Fix this code/essay," "Tell me what's wrong in this")
              4. Direct requests like "solve this" or "help with this homework"
              5. Any text that appears to be directly copied from a course assignment (IMPORTANT: If the prompt looks a question with a numerical answer or a multiple choice options, it's likely copy-pasted)
              
              These are considered GOOD LEARNING behavior and should be flagged as learning:
              1. Asking for explanations of concepts
              2. Requesting help with specific parts after showing attempt
              3. Asking about best practices or approaches
              4. Seeking to understand why something works
              5. Asking for guidance on problem-solving approach
              6. Breaking down complex problems
              7. Comparing different solutions or methods
              
              Respond with a JSON object containing:
              {
                "isLazy": boolean,
                "isLearning": boolean,
                "reason": string (explain VERY BRIEFLY why it was flagged as lazy or learning)
              }`
            },
            {
              role: 'user',
              content: promptText
            }
          ],
          temperature: 0.3,
          max_tokens: 150
        })
      });

      if (!response.ok) {
        console.error('OpenAI API error:', response.statusText);
        return fallbackAnalyzePrompt(promptText);
      }

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);

      if (result.isLazy) {
        const learningPrompt = await generateLearningPrompt(promptText);
        if (learningPrompt) {
          result.suggestedPrompt = learningPrompt.learningPrompt;
        }
      }

      return result;
    } catch (error) {
      console.error('Error analyzing prompt:', error);
      return fallbackAnalyzePrompt(promptText);
    }
  }

  function fallbackAnalyzePrompt(promptText) {
    const lazyPatterns = [
      /solve this/i,
      /write code for/i,
      /fix this code/i,
      /code solution/i,
      /do this for me/i,
      /what's the answer/i,
      /answer this question/i,
      /help me with this assignment/i,
      /complete this for me/i,
      /write a program/i,
      /write me a/i,
      /give me a/i,
      /create a/i
    ];
    
    const learningPatterns = [
      /explain the concept/i,
      /help me understand/i,
      /what are the principles/i,
      /how does this work/i,
      /why does this happen/i
    ];
    
    const isLazy = lazyPatterns.some(pattern => pattern.test(promptText));
    const isLearning = learningPatterns.some(pattern => pattern.test(promptText));
    
    if (isLearning) {
      state.thinkingPoints += 2;
      updateState();
    }

    return {
      isLazy,
      isLearning,
      reason: isLazy ? 'Pattern matched with lazy usage' : 'No lazy patterns detected'
    };
  }
  