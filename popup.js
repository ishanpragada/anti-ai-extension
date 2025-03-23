document.addEventListener('DOMContentLoaded', function() {
    let usageChart = null;
    
    document.getElementById('tab-stats').addEventListener('click', () => switchTab('stats'));
    document.getElementById('tab-settings').addEventListener('click', () => switchTab('settings'));
    document.getElementById('tab-history').addEventListener('click', () => switchTab('history'));
    
    updateUI();
    
    document.getElementById('daily-goal-select').addEventListener('change', (e) => {
      chrome.runtime.sendMessage({ 
        action: "setDailyGoal", 
        goal: parseInt(e.target.value) 
      }, updateUI);
    });
    
    document.getElementById('reset-all-stats').addEventListener('click', () => {
      chrome.runtime.sendMessage({ 
        action: "getState" 
      }, (response) => {
        if (!response || !response.state) return;
        
        const state = response.state;
        state.usage = {
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
        };
        state.thinkingPoints = 0;
        state.gamification = {
          dailyGoal: 5,
          currentStreak: 0,
          longestStreak: 0,
          lastGoalHit: null,
          level: 1,
          totalPoints: 0,
          achievements: [],
          dailyProgress: []
        };
        
        chrome.storage.local.set({ 'thinkFirstState': state }, updateUI);
      });
    });
    
    document.getElementById('reset-thinking-points').addEventListener('click', () => {
      chrome.runtime.sendMessage({ 
        action: "getState" 
      }, (response) => {
        if (!response || !response.state) return;
        
        const state = response.state;
        state.thinkingPoints = 0;
        state.gamification.totalPoints = 0;
        state.gamification.level = 1;
        state.gamification.dailyProgress = [];
        
        chrome.storage.local.set({ 'thinkFirstState': state }, updateUI);
      });
    });
    
    document.getElementById('mode-select').addEventListener('change', (e) => {
      chrome.runtime.sendMessage({ 
        action: "setMode", 
        mode: e.target.value 
      }, updateUI);
      updateModeDescription(e.target.value);
    });
    
    function createUsageChart(data) {
      const ctx = document.getElementById('usage-chart').getContext('2d');
      
      if (usageChart) {
        usageChart.destroy();
      }
      
      const dates = data.map(d => new Date(d.date).toLocaleDateString());
      const counts = data.map(d => d.count);
      
      usageChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: dates,
          datasets: [{
            label: 'AI Usage',
            data: counts,
            borderColor: '#4a86e8',
            backgroundColor: 'rgba(74, 134, 232, 0.1)',
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                stepSize: 1
              }
            }
          }
        }
      });
    }
    
    function updateModeDescription(mode) {
      const description = document.getElementById('mode-description');
      switch (mode) {
        case 'relaxed':
          description.textContent = 'Relaxed mode only tracks your AI usage without any interventions. Use this mode when you want to monitor your usage patterns.';
          break;
        case 'normal':
          description.textContent = 'Normal mode will intervene when it detects lazy prompts like "solve this for me" or "write code for this". It encourages you to think before asking AI for help.';
          break;
        case 'strict':
          description.textContent = 'Strict mode intervenes on all AI usage, encouraging you to think through problems thoroughly before consulting AI. Best for learning and skill development.';
          break;
      }
    }
    
    function updateUI() {
      chrome.runtime.sendMessage({ action: "getState" }, (response) => {
        if (!response || !response.state) return;
        
        const state = response.state;
        
        document.getElementById('today-usage').textContent = state.usage.today;
        document.getElementById('week-usage').textContent = state.usage.week;
        document.getElementById('month-usage').textContent = state.usage.month;
        document.getElementById('thinking-points').textContent = state.thinkingPoints;
        document.getElementById('current-mode').textContent = state.mode.charAt(0).toUpperCase() + state.mode.slice(1);
        
        document.getElementById('current-level').textContent = state.gamification.level;
        document.getElementById('level-number').textContent = state.gamification.level;
        
        const pointsInLevel = state.gamification.totalPoints % 100;
        const progressPercent = (pointsInLevel / 100) * 100;
        document.getElementById('level-progress').style.width = `${progressPercent}%`;
        
        document.getElementById('current-streak').textContent = state.gamification.currentStreak;
        document.getElementById('longest-streak').textContent = state.gamification.longestStreak;
        
        const today = new Date().toISOString().split('T')[0];
        const todayProgress = state.gamification.dailyProgress.find(d => d.date === today);
        const currentPoints = todayProgress ? todayProgress.points : 0;
        const goalPercent = (currentPoints / state.gamification.dailyGoal) * 100;
        
        document.getElementById('daily-goal-progress').textContent = 
          `${currentPoints}/${state.gamification.dailyGoal}`;
        document.getElementById('daily-goal-fill').style.width = `${Math.min(100, goalPercent)}%`;
        document.getElementById('daily-goal-select').value = state.gamification.dailyGoal;
        
        document.getElementById('mode-select').value = state.mode;
        updateModeDescription(state.mode);
        
        if (state.usage.history.daily.length > 0) {
          createUsageChart(state.usage.history.daily);
        }
        
        updateHistoryList();
      });
    }
    
    function updateHistoryList() {
      chrome.runtime.sendMessage({ action: "getState" }, (response) => {
        if (!response || !response.state) return;
        
        const state = response.state;
        const historyContainer = document.getElementById('history-list');
        historyContainer.innerHTML = '';
        
        if (state.history.length === 0) {
          historyContainer.innerHTML = '<p style="padding: 12px; color: #666;">No AI prompts recorded yet.</p>';
          return;
        }
        
        const sortedHistory = [...state.history].reverse();
        
        sortedHistory.forEach(item => {
          const historyItem = document.createElement('div');
          historyItem.className = 'history-item';
          
          const date = new Date(item.timestamp);
          const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
          
          historyItem.innerHTML = `
            <div class="timestamp">${formattedDate} - ${item.site}</div>
            <div class="prompt">${truncateText(item.prompt, 50)}</div>
          `;
          
          historyContainer.appendChild(historyItem);
        });
      });
    }
    
    function truncateText(text, maxLength) {
      if (text.length <= maxLength) return text;
      return text.substr(0, maxLength) + '...';
    }
  });
  
  function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.remove('active');
    });
    
    document.querySelectorAll('.tab-button').forEach(button => {
      button.classList.remove('active');
    });
    
    document.getElementById(`tab-content-${tabName}`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
  }
  