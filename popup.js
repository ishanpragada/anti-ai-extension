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
    
    document.getElementById('reset-today-stats').addEventListener('click', () => {
      console.log('Reset today stats button clicked');
      chrome.runtime.sendMessage({ 
        action: "resetTodayStats" 
      }, (response) => {
        console.log('Reset today stats response:', response);
        if (response && response.success) {
          // Update the UI first
          updateUI();
          
          // Add visual feedback that the reset was successful
          ['today-usage', 'week-usage', 'month-usage'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
              // Add the animation class
              element.classList.add('updating');
              // Remove it after animation completes
              setTimeout(() => {
                element.classList.remove('updating');
              }, 1000);
            }
          });
        }
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
      
      // Get today's date
      const today = new Date();
      const todayDateStr = formatLocalDate(today);
      
      // Make sure all dates are correctly parsed with the local timezone
      const processedData = data.map(entry => {
        // Ensure date is in YYYY-MM-DD format
        const [year, month, day] = entry.date.split('-').map(num => parseInt(num, 10));
        // Create date manually to avoid timezone issues
        const localDate = new Date(year, month - 1, day);
        // Check if this is today
        const isToday = entry.date === todayDateStr;
        return {
          ...entry,
          localDate,
          isToday
        };
      });
      
      // Sort data by date to ensure correct ordering - most recent at the end
      processedData.sort((a, b) => a.localDate - b.localDate);
      
      // Get only the last 7 days of data, ensuring we have the most recent 7 days only
      const uniqueDates = [...new Map(
        processedData.map(entry => [entry.date, entry])
      ).values()];
      
      const lastWeekData = uniqueDates.slice(-7);
      
      // Format dates as days of the week
      const dates = lastWeekData.map(d => {
        return d.localDate.toLocaleDateString(undefined, { weekday: 'short' });
      });
      
      // Store which index corresponds to today for styling
      const todayIndex = lastWeekData.findIndex(d => d.isToday);
      
      const counts = lastWeekData.map(d => d.count);
      
      // Create background colors array - highlight today's bar
      const backgroundColors = lastWeekData.map(d => 
        d.isToday ? '#5b96f0' : '#4a86e8'
      );
      
      const borderColors = lastWeekData.map(d => 
        d.isToday ? '#3a78e0' : '#3b78e7'
      );
      
      // Log the dates we're showing for debugging
      console.log('Chart data:', {
        rawDates: lastWeekData.map(d => d.date),
        formattedDates: dates,
        counts,
        today: todayDateStr
      });
      
      usageChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: dates,
          datasets: [{
            label: 'AI Usage',
            data: counts,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: 1,
            borderRadius: 4,
            maxBarThickness: 35
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                title: function(tooltipItems) {
                  const index = tooltipItems[0].dataIndex;
                  const datapoint = lastWeekData[index];
                  if (datapoint) {
                    // Show full date format in tooltip
                    return `${tooltipItems[0].label} (${datapoint.localDate.toLocaleDateString()})`;
                  }
                  return tooltipItems[0].label;
                },
                label: function(context) {
                  // Only show tooltip for bars with values greater than zero
                  if (context.raw === 0) {
                    return '';
                  }
                  return `Usage: ${context.raw}`;
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                stepSize: 1,
                precision: 0
              },
              grid: {
                display: true,
                drawBorder: false
              }
            },
            x: {
              grid: {
                display: false,
                drawBorder: false
              },
              ticks: {
                font: function(context) {
                  // Make today's label bold
                  if (todayIndex !== -1 && context.index === todayIndex) {
                    return {
                      weight: 'bold',
                      size: 11
                    };
                  }
                  return {
                    size: 11
                  };
                }
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
          description.textContent = 'Relaxed mode tracks your AI usage without interventions. Uses local pattern matching to award thinking points (no AI calls are made in this mode).';
          break;
        case 'normal':
          description.textContent = 'Normal mode will intervene when it detects lazy prompts like "solve this for me" or "write code for this". It encourages you to think before asking AI for help.';
          break;
        case 'strict':
          description.textContent = 'Strict mode intervenes on all AI usage, encouraging you to think through problems thoroughly before consulting AI. Best for learning and skill development.';
          break;
      }
    }
    
    // Format a date as YYYY-MM-DD in local time zone (same as background.js)
    function formatLocalDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    
    // Helper function to parse a YYYY-MM-DD date string into a Date object (same as background.js)
    function parseLocalDate(dateStr) {
      const [year, month, day] = dateStr.split('-').map(num => parseInt(num, 10));
      return new Date(year, month - 1, day);
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
        
        const today = formatLocalDate(new Date());
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
          // Log current data for debugging
          console.log('Daily history before chart creation:', state.usage.history.daily);
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
          
          // Parse the ISO date string
          const date = new Date(item.timestamp);
          
          // Format the date with more details
          const formattedDate = date.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
          
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
  