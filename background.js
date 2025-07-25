importScripts('env.js');

const OPENAI_API_KEY = env.OPENAI_API_KEY;
const OPENAI_API_ENDPOINT = env.OPENAI_API_ENDPOINT;

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
    
    // Ensure the daily history is sorted before checking counters
    ensureSortedDailyHistory();
    
    // Recalculate the weekly count based on the loaded history
    calculateWeeklyCount();
    
    // Recalculate the monthly count based on the loaded history
    calculateMonthlyCount();
    
    // Now check and reset counters as needed
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
  
  // Get dates in YYYY-MM-DD format for consistent comparison
  // Use local time zone instead of UTC
  const nowDate = formatLocalDate(now);
  const lastDailyDate = formatLocalDate(lastDaily);
  
  // Debug log to help track date changes
  console.log('Date check:', {
    nowDate,
    lastDailyDate,
    currentHistory: state.usage.history.daily
  });

  // Check if we have more than a day difference, meaning we might have skipped some days
  const dayDiff = getDaysDifference(lastDaily, now);
  
  if (nowDate !== lastDailyDate) {
    // Reset daily counter
    state.usage.today = 0;
    state.usage.lastReset.daily = now.toISOString();
    
    // Update history
    let last29Days = state.usage.history.daily.slice(-29);
    
    // If we skipped more than one day, fill in the missing days with zero counts
    if (dayDiff > 1) {
      last29Days = fillMissingDays(last29Days, lastDaily, now);
    }
    
    // Check if we already have an entry for today
    const todayEntry = last29Days.find(entry => entry.date === nowDate);
    
    if (todayEntry) {
      // If we have an entry for today, reset its count 
      // (it might be a testing scenario where the date was changed)
      todayEntry.count = 0;
    } else {
      // If we don't have an entry for today, add it
      last29Days.push({ date: nowDate, count: 0 });
    }
    
    // Make sure history is sorted by date
    last29Days.sort((a, b) => {
      const dateA = parseLocalDate(a.date);
      const dateB = parseLocalDate(b.date);
      return dateA - dateB;
    });
    
    state.usage.history.daily = last29Days;
  }

  // Get current week and month identifiers
  const currentWeek = getWeekNumber(now);
  const currentMonth = formatLocalDate(now).slice(0, 7); // YYYY-MM
  
  // Get last week and month from the last reset dates
  const lastWeek = getWeekNumber(lastWeekly);
  const lastMonth = formatLocalDate(lastWeekly).slice(0, 7);
  
  console.log('Week/Month check:', {
    currentWeek,
    lastWeek,
    currentMonth,
    lastMonth,
    weeklyHistory: state.usage.history.weekly,
    monthlyHistory: state.usage.history.monthly
  });
  
  // Recalculate weekly count using rolling 7-day window
  calculateWeeklyCount();

  // Recalculate monthly count based on daily history
  calculateMonthlyCount();

  updateState();
}

// Helper function to calculate days difference between two dates
function getDaysDifference(date1, date2) {
  const date1Str = formatLocalDate(date1);
  const date2Str = formatLocalDate(date2);
  
  // Parse local dates to get consistent values
  const d1 = parseLocalDate(date1Str);
  const d2 = parseLocalDate(date2Str);
  
  // Calculate the difference in days
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

// Helper function to parse a YYYY-MM-DD date string into a Date object
function parseLocalDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    console.error('Invalid date string:', dateStr);
    return new Date(); // Return today as fallback
  }
  
  try {
    // Split the date string and construct a Date object
    const [year, month, day] = dateStr.split('-').map(num => parseInt(num, 10));
    
    // Validate date components
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      console.error('Invalid date components:', { year, month, day });
      return new Date();
    }
    
    // Create date with time set to midnight
    const date = new Date(year, month - 1, day, 0, 0, 0, 0);
    
    // Verify the date is valid
    if (isNaN(date.getTime())) {
      console.error('Date is invalid after parsing:', dateStr);
      return new Date();
    }
    
    return date;
  } catch (error) {
    console.error('Error parsing date:', error);
    return new Date();
  }
}

// Fill in missing days between two dates in the history array
function fillMissingDays(history, startDate, endDate) {
  const result = [...history];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Increment by one day to start from the day after startDate
  start.setDate(start.getDate() + 1);
  
  // Create a date for iterating
  const current = new Date(start);
  
  // Loop through each day between start and end (exclusive of end)
  while (current < end) {
    const dateStr = formatLocalDate(current);
    
    // Check if we already have this date in the history
    if (!result.find(entry => entry.date === dateStr)) {
      // If not, add it with count 0
      result.push({ date: dateStr, count: 0 });
    }
    
    // Move to the next day
    current.setDate(current.getDate() + 1);
  }
  
  return result;
}

// Format a date as YYYY-MM-DD in local time zone
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
    
    case "resetTodayStats":
      console.log('Resetting today stats');
      console.log('Before reset - today count:', state.usage.today);
      
      // Save current today value to subtract from monthly counts
      const todayValue = state.usage.today;
      
      // Reset today's counter
      state.usage.today = 0;
      state.usage.lastReset.daily = new Date().toISOString();
      
      // Find today's entry in history and reset it or create a new one
      const today = formatLocalDate(new Date());
      console.log('Today date:', today);
      
      let todayEntry = state.usage.history.daily.find(entry => entry.date === today);
      if (todayEntry) {
        console.log('Found today entry, resetting count from', todayEntry.count, 'to 0');
        todayEntry.count = 0;
      } else {
        console.log('No entry for today, creating new one');
        // If no entry exists for today, create one
        state.usage.history.daily.push({ date: today, count: 0 });
        
        // Make sure history is sorted by date
        state.usage.history.daily.sort((a, b) => {
          const dateA = parseLocalDate(a.date);
          const dateB = parseLocalDate(b.date);
          return dateA - dateB;
        });
      }
      
      // Update monthly history to reflect the reset
      const thisMonth = formatLocalDate(new Date()).slice(0, 7);
      
      let monthlyEntry = state.usage.history.monthly.find(m => m.month === thisMonth);
      if (monthlyEntry) {
        monthlyEntry.count = Math.max(0, monthlyEntry.count - todayValue);
      }
      
      // Recalculate the weekly count with our rolling 7-day window
      calculateWeeklyCount();
      
      // Recalculate the monthly count
      calculateMonthlyCount();
      
      console.log('After reset - state:', JSON.stringify({
        today: state.usage.today,
        week: state.usage.week,
        month: state.usage.month,
        dailyHistory: state.usage.history.daily
      }));
      
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
  
  const now = new Date();
  const today = formatLocalDate(now);
  const thisMonth = formatLocalDate(now).slice(0, 7); // YYYY-MM
  
  console.log('Before prompt update:', {
    today,
    thisMonth,
    monthlyHistory: state.usage.history.monthly,
    currentMonthCount: state.usage.month
  });
  
  // Update daily history
  let dailyEntry = state.usage.history.daily.find(d => d.date === today);
  if (dailyEntry) {
    dailyEntry.count++;
  } else {
    state.usage.history.daily.push({ date: today, count: 1 });
    
    // Sort the daily history by date to maintain chronological order
    state.usage.history.daily.sort((a, b) => {
      const dateA = parseLocalDate(a.date);
      const dateB = parseLocalDate(b.date);
      return dateA - dateB;
    });
  }
  
  // Update monthly history
  let monthlyEntry = state.usage.history.monthly.find(m => m.month === thisMonth);
  if (monthlyEntry) {
    monthlyEntry.count++;
  } else {
    state.usage.history.monthly.push({ month: thisMonth, count: 1 });
  }
  
  // Ensure we keep only the last 30 days of data
  state.usage.history.daily = state.usage.history.daily.slice(-30);

  // Calculate the weekly total using our rolling 7-day window
  calculateWeeklyCount();

  // Calculate the monthly total based on daily history
  calculateMonthlyCount();

  console.log('After prompt update:', {
    dailyHistory: state.usage.history.daily,
    monthlyHistory: state.usage.history.monthly,
    calculatedMonthlyCount: state.usage.month
  });
  
  state.lastPrompt = promptText;
  
  state.history.push({
    prompt: promptText,
    site: site,
    timestamp: now.toISOString(),
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

// Modified to use a rolling 7-day window instead of ISO weeks
function getWeekNumber(d) {
  // Get the date as YYYY-MM-DD
  const dateStr = formatLocalDate(d);
  
  // This makes each day have its own "week" identifier
  // We'll use the date as the identifier, and we'll count all prompts 
  // from the last 7 days in the "week" count
  return dateStr;
}

// Function to ensure daily history is sorted by date
function ensureSortedDailyHistory() {
  if (!state.usage.history.daily || !Array.isArray(state.usage.history.daily)) {
    console.error('Daily history is not an array:', state.usage.history.daily);
    state.usage.history.daily = [];
    return;
  }

  // First, filter out any invalid entries
  state.usage.history.daily = state.usage.history.daily.filter(entry => {
    return entry && entry.date && typeof entry.date === 'string' && 
           !isNaN(parseLocalDate(entry.date).getTime());
  });

  // Sort the history by date
  state.usage.history.daily.sort((a, b) => {
    try {
      const dateA = parseLocalDate(a.date);
      const dateB = parseLocalDate(b.date);
      return dateA - dateB;
    } catch (error) {
      console.error('Error comparing dates:', error);
      return 0;
    }
  });

  console.log('Daily history sorted:', state.usage.history.daily.map(e => e.date));
}

// Calculate the weekly count as a sum of the last 7 days
function calculateWeeklyCount() {
  // Ensure daily history is properly sorted before calculating
  ensureSortedDailyHistory();
  
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6); // 7 days including today
  
  // Set times to midnight for consistent comparison
  sevenDaysAgo.setHours(0, 0, 0, 0);
  
  console.log('Weekly window:', {
    from: formatLocalDate(sevenDaysAgo),
    to: formatLocalDate(today),
    allDailyEntries: state.usage.history.daily.map(e => e.date)
  });
  
  // Filter daily history to get only the last 7 days
  const last7DaysEntries = state.usage.history.daily.filter(entry => {
    const entryDate = parseLocalDate(entry.date);
    // Set time to midnight for consistent comparison
    entryDate.setHours(0, 0, 0, 0);
    
    // Debug log to see what's being compared
    const isIncluded = entryDate >= sevenDaysAgo;
    
    console.log(`Entry date ${entry.date} (${entryDate}) >= sevenDaysAgo ${formatLocalDate(sevenDaysAgo)} (${sevenDaysAgo}): ${isIncluded}`);
    
    return isIncluded;
  });
  
  // Sum the counts for the last 7 days
  const weeklyTotal = last7DaysEntries.reduce((sum, entry) => sum + entry.count, 0);
  
  // Update the week count
  state.usage.week = weeklyTotal;
  
  // For consistency, update the weekly history to match the rolling window approach
  state.usage.history.weekly = [{
    week: formatLocalDate(today),
    count: weeklyTotal
  }];
  
  console.log('Recalculated weekly count based on 7-day rolling window:', {
    weeklyTotal,
    countedDays: last7DaysEntries.map(e => e.date)
  });
  
  return weeklyTotal;
}

function handleThinkingPoints(points) {
  const newPoints = Math.max(0, state.thinkingPoints + points);
  const pointsToAdd = newPoints - state.thinkingPoints;
  
  state.thinkingPoints = newPoints;
  state.gamification.totalPoints = Math.max(0, state.gamification.totalPoints + pointsToAdd);
  
  const today = formatLocalDate(new Date());
  let dailyProgress = state.gamification.dailyProgress.find(d => d.date === today);
  if (dailyProgress) {
    dailyProgress.points = Math.max(0, dailyProgress.points + pointsToAdd);
  } else {
    state.gamification.dailyProgress.push({ date: today, points: Math.max(0, pointsToAdd) });
  }
  
  if (dailyProgress && dailyProgress.points >= state.gamification.dailyGoal) {
    const lastGoalDate = state.gamification.lastGoalHit ? 
      formatLocalDate(new Date(state.gamification.lastGoalHit)) : null;
    
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
  return formatLocalDate(date);
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
    // Get current state to check if we're in relaxed mode
    const currentMode = state.mode;
    
    // If in relaxed mode, use the fallback analysis without API call to save costs
    if (currentMode === 'relaxed') {
      console.log('Relaxed mode: Using heuristic analysis instead of AI API');
      return fallbackAnalyzePrompt(promptText);
    }
    
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
    /create a/i,
    /generate a/i,
    /implement a/i,
    /write a function/i,
    /build me/i,
    /write an essay/i,
    /write a story/i,
    /finish this/i,
    /answer the following/i,
    /summarize this/i
  ];
  
  const learningPatterns = [
    /explain the concept/i,
    /help me understand/i,
    /what are the principles/i,
    /how does this work/i,
    /why does this happen/i,
    /can you elaborate/i,
    /could you clarify/i,
    /what is the difference between/i,
    /how would you compare/i,
    /can you explain the reasoning/i,
    /how can I learn/i,
    /why is it important/i,
    /what approach should I take/i,
    /how should I think about/i,
    /walk me through/i
  ];
  
  const isLazy = lazyPatterns.some(pattern => pattern.test(promptText));
  const isLearning = learningPatterns.some(pattern => pattern.test(promptText));
  
  if (isLearning) {
    state.thinkingPoints += 2;
    updateState();
  }

  // Log the result for debugging purposes when in relaxed mode
  if (state.mode === 'relaxed') {
    console.log('Relaxed mode pattern matching result:', {
      isLazy,
      isLearning,
      promptText: promptText.substring(0, 50) + (promptText.length > 50 ? '...' : '')
    });
  }

  return {
    isLazy,
    isLearning,
    reason: isLazy ? 'Pattern matched with lazy usage' : 
            isLearning ? 'Pattern matched with learning-focused prompt' : 
            'No specific patterns detected'
  };
}

// Function to calculate the monthly count based on daily history
function calculateMonthlyCount() {
  const now = new Date();
  const thisMonth = formatLocalDate(now).slice(0, 7); // YYYY-MM
  
  // Calculate count based on daily history
  const currentMonthEntries = state.usage.history.daily.filter(entry => 
    entry.date.startsWith(thisMonth)
  );
  const monthlyTotal = currentMonthEntries.reduce((sum, entry) => sum + entry.count, 0);
  
  // Update the month count
  state.usage.month = monthlyTotal;
  
  // Update or add the monthly history entry
  let monthlyEntry = state.usage.history.monthly.find(m => m.month === thisMonth);
  if (monthlyEntry) {
    monthlyEntry.count = monthlyTotal;
  } else {
    state.usage.history.monthly.push({ month: thisMonth, count: monthlyTotal });
  }
  
  // Ensure we keep only the last 12 months of data
  state.usage.history.monthly = state.usage.history.monthly.slice(-12);
  
  console.log('Recalculated monthly count:', {
    month: thisMonth,
    count: monthlyTotal,
    entriesIncluded: currentMonthEntries.map(e => e.date)
  });
  
  return monthlyTotal;
}
  