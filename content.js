let promptText = "";
let lastKnownValue = "";
let lastSubmittedValue = "";
let pendingSubmission = null;
let interventionActive = false;
let siteDetected = window.location.hostname;
let isSetup = false;
let inputDebounceTimeout = null;
let originalSubmitHandler = null;
let lastSubmissionTimestamp = 0;
let lastSubmittedPrompt = "";
let isSubmitting = false;

// Move chatgptSelectors to global scope
const chatgptSelectors = {
  textarea: '#prompt-textarea',
  sendButton: '[data-testid="send-button"]',
  form: 'form'
};

function debugLog(message, data = null) {
  console.log(`[ThinkFirst] ${message}`, data || '');
}

function getInputValue(input) {
  try {
    if (!input) return '';
    
    const value = input.value || input.innerText || input.textContent || '';
    debugLog('Raw input value:', value);
    return value;
  } catch (err) {
    debugLog('Error getting input value:', err);
    return '';
  }
}

function safeSendMessage(message) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        debugLog('Chrome runtime not available');
        resolve(null);
        return;
      }

      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          debugLog('Chrome runtime error:', chrome.runtime.lastError);
          if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
            debugLog('Extension context invalid, reloading...');
            isSetup = false;
            initialize();
          }
          resolve(null);
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      debugLog('Error sending message:', err);
      isSetup = false;
      initialize();
      resolve(null);
    }
  });
}

function injectUI() {
  debugLog('Injecting UI elements');
  if (document.getElementById('think-first-overlay')) {
    return;
  }

  const brainIcon = document.createElement('div');
  brainIcon.id = 'think-first-brain';
  brainIcon.innerHTML = '🧠';
  brainIcon.addEventListener('click', toggleSettings);
  
  const notification = document.createElement('div');
  notification.id = 'think-first-notification';
  notification.className = 'think-first-notification think-first-hidden';
  
  const settingsPanel = document.createElement('div');
  settingsPanel.className = 'think-first-settings think-first-hidden';
  settingsPanel.innerHTML = `
    <h3>🧠 ThinkFirst</h3>
    
    <div class="tab-buttons">
      <button id="settings-tab-stats" class="tab-button active">Stats</button>
      <button id="settings-tab-settings" class="tab-button">Settings</button>
      <button id="settings-tab-history" class="tab-button">History</button>
    </div>
    
    <div id="settings-tab-content-stats" class="tab active">
      <div class="graph-container">
        <h4>Last 7 Days Usage</h4>
        <canvas id="settings-usage-chart"></canvas>
      </div>
      
      <div class="stats">
        <p>
          <span class="stat-label">Today's AI usage</span>
          <span id="settings-today-usage" class="stat-value">0</span>
        </p>
        <p>
          <span class="stat-label">This week</span>
          <span id="settings-week-usage" class="stat-value">0</span>
        </p>
        <p>
          <span class="stat-label">This month</span>
          <span id="settings-month-usage" class="stat-value">0</span>
        </p>
        <p>
          <span class="stat-label">Thinking points</span>
          <span id="settings-thinking-points" class="stat-value">0</span>
        </p>
        <p>
          <span class="stat-label">Current mode</span>
          <span id="settings-current-mode" class="stat-value">Normal</span>
        </p>
      </div>
      
      <div class="section">
        <h4>Quick Actions</h4>
        <div class="controls">
          <button id="settings-reset-daily-stats">Reset Today's Stats</button>
        </div>
      </div>
    </div>
    
    <div id="settings-tab-content-settings" class="tab">
      <div class="section">
        <h4>Monitoring Mode</h4>
        <div class="controls">
          <select id="settings-mode-select">
            <option value="relaxed">Relaxed - Just track usage</option>
            <option value="normal">Normal - Intervene on lazy usage</option>
            <option value="strict">Strict - Intervene on all usage</option>
          </select>
          <div class="mode-description" id="settings-mode-description">
            Normal mode will intervene when it detects lazy prompts like "solve this for me" or "write code for this". It encourages you to think before asking AI for help.
          </div>
        </div>
      </div>
      
      <div class="section">
        <h4>Reset Options</h4>
        <div class="controls">
          <button id="settings-reset-all-stats">Reset All Statistics</button>
          <button id="settings-reset-thinking-points">Reset Thinking Points</button>
        </div>
      </div>
    </div>
    
    <div id="settings-tab-content-history" class="tab">
      <div class="section">
        <h4>Recent AI Prompts</h4>
        <div id="settings-history-list" class="history-list">
          <!-- History items will be inserted here -->
        </div>
      </div>
    </div>
  `;

  settingsPanel.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  const overlay = document.createElement('div');
  overlay.id = 'think-first-overlay';
  overlay.className = 'think-first-overlay think-first-hidden';

  const container = document.createElement('div');
  container.className = 'think-first-container';
  
  const header = document.createElement('div');
  header.className = 'think-first-header';
  header.innerHTML = '🧠 ThinkFirst';
  container.appendChild(header);
  
  const content = document.createElement('div');
  content.className = 'think-first-content';
  container.appendChild(content);
  
  const thinkingPrompt = document.createElement('div');
  thinkingPrompt.id = 'think-first-thinking-prompt';
  content.appendChild(thinkingPrompt);
  
  const buttons = document.createElement('div');
  buttons.id = 'think-first-buttons';
  
  const continueButton = document.createElement('button');
  continueButton.id = 'think-first-continue';
  continueButton.textContent = "I've REALLY thought about it (Continue)";
  continueButton.addEventListener('click', handleContinue);
  
  const cancelButton = document.createElement('button');
  cancelButton.id = 'think-first-cancel';
  cancelButton.textContent = "Let me think more... (Cancel)";
  cancelButton.addEventListener('click', handleCancel);
  
  buttons.appendChild(continueButton);
  buttons.appendChild(cancelButton);
  content.appendChild(buttons);
  
  overlay.appendChild(container);
  
  document.body.appendChild(brainIcon);
  document.body.appendChild(settingsPanel);
  document.body.appendChild(overlay);
  document.body.appendChild(notification);

  setupSettingsListeners();
  updateSettingsPanel();
}

async function checkPendingIntervention() {
  try {
    const data = await new Promise(resolve => {
      chrome.storage.local.get(['pendingIntervention'], resolve);
    });
    
    if (data.pendingIntervention) {
      debugLog('Found pending intervention:', data.pendingIntervention);
      pendingSubmission = data.pendingIntervention.promptText;
      showIntervention(data.pendingIntervention.promptText, data.pendingIntervention.reason);
    }
  } catch (err) {
    debugLog('Error checking pending intervention:', err);
  }
}

async function setPendingIntervention(promptText, reason = null) {
  try {
    await new Promise(resolve => {
      chrome.storage.local.set({
        pendingIntervention: {
          promptText,
          reason,
          timestamp: Date.now()
        }
      }, resolve);
    });
  } catch (err) {
    debugLog('Error setting pending intervention:', err);
  }
}

async function clearPendingIntervention() {
  try {
    await new Promise(resolve => {
      chrome.storage.local.remove('pendingIntervention', resolve);
    });
  } catch (err) {
    debugLog('Error clearing pending intervention:', err);
  }
}

function handleContinue() {
  const overlay = document.getElementById('think-first-overlay');
  if (overlay) {
    overlay.classList.add('think-first-hidden');
    document.body.classList.remove('think-first-active');
    
    clearPendingIntervention();
    
    const brainIcon = document.getElementById('think-first-brain');
    if (brainIcon) {
      brainIcon.classList.add('bad-decision');
      setTimeout(() => {
        brainIcon.classList.remove('bad-decision');
      }, 500);
    }
    
    chrome.runtime.sendMessage({ 
      action: "getState" 
    }, (response) => {
      if (!response || !response.state) return;
      
      const state = response.state;
      if (state.thinkingPoints > 0) {
        chrome.runtime.sendMessage({ 
          action: "logThinking", 
          points: -1 
        }, () => {
          const pointsElement = document.createElement('div');
          pointsElement.className = 'points-animation negative';
          pointsElement.textContent = '-1 🧠';
          document.body.appendChild(pointsElement);
          
          setTimeout(() => {
            pointsElement.remove();
          }, 1500);
        });
      }
    });
  }
}

function handleCancel() {
  const reason = document.querySelector('.think-first-reason')?.textContent?.replace('Reason: ', '') || null;
  if (pendingSubmission) {
    setPendingIntervention(pendingSubmission, { reason });
  }
  
  chrome.runtime.sendMessage({ action: "closeTab" });
}

function toggleSettings() {
  let settingsPanel = document.querySelector('.think-first-settings');
  if (!settingsPanel) {
    debugLog('Settings panel not found, reinitializing UI');
    injectUI();
    settingsPanel = document.querySelector('.think-first-settings');
    if (!settingsPanel) {
      debugLog('Failed to create settings panel');
      return;
    }
  }
  
  if (settingsPanel.classList.contains('think-first-hidden')) {
    // Ensure data is refreshed before showing the panel
    chrome.runtime.sendMessage({ action: "getState" }, (response) => {
      // Only show panel after we've received data to prevent flickering empty state
      if (response && response.state) {
        settingsPanel.classList.remove('think-first-hidden');
        updateSettingsPanel();
      } else {
        // If failed to get state, still show panel but log error
        debugLog('Failed to get extension state, showing panel with potentially stale data');
        settingsPanel.classList.remove('think-first-hidden');
        // Try to update with local data anyway
        updateSettingsPanel();
      }
    });
  } else {
    settingsPanel.classList.add('think-first-hidden');
  }
}

function setupSettingsListeners() {
  document.getElementById('settings-tab-stats').addEventListener('click', () => switchSettingsTab('stats'));
  document.getElementById('settings-tab-settings').addEventListener('click', () => switchSettingsTab('settings'));
  document.getElementById('settings-tab-history').addEventListener('click', () => switchSettingsTab('history'));
  
  document.getElementById('settings-reset-daily-stats').addEventListener('click', () => {
    chrome.runtime.sendMessage({ 
      action: "resetTodayStats" 
    }, (response) => {
      if (response && response.success) {
        updateSettingsPanel();
        // showNotification('Today\'s stats have been reset', 2000);
      }
    });
  });
  
  document.getElementById('settings-reset-all-stats').addEventListener('click', () => {
    chrome.runtime.sendMessage({ 
      action: "getState" 
    }, (response) => {
      if (!response || !response.state) return;
      
      const state = response.state;
      state.usage = {
        today: 0,
        week: 0,
        month: 0,
        lastReset: {
          daily: new Date().toISOString(),
          weekly: new Date().toISOString(),
          monthly: new Date().toISOString()
        }
      };
      state.thinkingPoints = 0;
      
      chrome.storage.local.set({ 'thinkFirstState': state }, updateSettingsPanel);
    });
  });
  
  document.getElementById('settings-reset-thinking-points').addEventListener('click', () => {
    chrome.runtime.sendMessage({ 
      action: "getState" 
    }, (response) => {
      if (!response || !response.state) return;
      
      const state = response.state;
      state.thinkingPoints = 0;
      
      chrome.storage.local.set({ 'thinkFirstState': state }, updateSettingsPanel);
    });
  });
  
  document.getElementById('settings-mode-select').addEventListener('change', (e) => {
    chrome.runtime.sendMessage({ 
      action: "setMode", 
      mode: e.target.value 
    }, updateSettingsPanel);
    updateSettingsModeDescription(e.target.value);
  });

  document.addEventListener('click', (e) => {
    const settingsPanel = document.querySelector('.think-first-settings');
    const brainIcon = document.getElementById('think-first-brain');
    if (settingsPanel && brainIcon && !settingsPanel.contains(e.target) && !brainIcon.contains(e.target)) {
      settingsPanel.classList.add('think-first-hidden');
    }
  });
}

function switchSettingsTab(tabName) {
  document.querySelectorAll('.think-first-settings .tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  document.querySelectorAll('.think-first-settings .tab-button').forEach(button => {
    button.classList.remove('active');
  });
  
  document.getElementById(`settings-tab-content-${tabName}`).classList.add('active');
  document.getElementById(`settings-tab-${tabName}`).classList.add('active');
}

function updateSettingsModeDescription(mode) {
  const description = document.getElementById('settings-mode-description');
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

function updateSettingsPanel() {
  chrome.runtime.sendMessage({ action: "getState" }, (response) => {
    if (!response || !response.state) return;
    
    const state = response.state;
    
    const stats = [
      { id: 'settings-today-usage', value: state.usage.today },
      { id: 'settings-week-usage', value: state.usage.week },
      { id: 'settings-month-usage', value: state.usage.month },
      { id: 'settings-thinking-points', value: state.thinkingPoints }
    ];
    
    stats.forEach(stat => {
      const element = document.getElementById(stat.id);
      if (element && element.textContent !== stat.value.toString()) {
        element.textContent = stat.value;
        animateStatUpdate(stat.id);
      }
    });
    
    if (state.usage.history.daily.length >= 0) {
      createSettingsUsageChart(state.usage.history.daily);
    }
    
    const modeSelect = document.getElementById('settings-mode-select');
    if (modeSelect && modeSelect.value !== state.mode) {
      modeSelect.value = state.mode;
      pulseBrainIcon();
    }
    
    document.getElementById('settings-current-mode').textContent = 
      state.mode.charAt(0).toUpperCase() + state.mode.slice(1);
    
    updateSettingsModeDescription(state.mode);
    updateSettingsHistoryList();
  });
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function updateSettingsHistoryList() {
  chrome.runtime.sendMessage({ action: "getState" }, (response) => {
    if (!response || !response.state) {
      debugLog('No state received for history update');
      return;
    }
    
    const state = response.state;
    const historyContainer = document.getElementById('settings-history-list');
    if (!historyContainer) {
      debugLog('History container not found');
      return;
    }
    
    try {
      historyContainer.innerHTML = '';
      
      if (!state.history || state.history.length === 0) {
        historyContainer.innerHTML = '<p style="padding: 12px; color: #666;">No AI prompts recorded yet.</p>';
        return;
      }
      
      const sortedHistory = [...state.history]
        .reverse()
        .slice(0, 50);
      
      debugLog('Updating history list with entries:', sortedHistory.length);
      
      sortedHistory.forEach(item => {
        try {
          const historyItem = document.createElement('div');
          historyItem.className = 'history-item';
          
          const date = new Date(item.timestamp);
          const formattedDate = date.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
          
          historyItem.innerHTML = `
            <div class="timestamp">${formattedDate} - ${item.site || 'Unknown site'}</div>
            <div class="prompt">${truncateText(item.prompt, 100)}</div>
          `;
          
          historyContainer.appendChild(historyItem);
        } catch (err) {
          debugLog('Error creating history item:', err);
        }
      });
    } catch (err) {
      debugLog('Error updating history list:', err);
      historyContainer.innerHTML = '<p style="padding: 12px; color: #666;">Error loading history.</p>';
    }
  });
}

function showNotification(message, duration = 3000) {
  const notification = document.getElementById('think-first-notification');
  if (notification) {
    notification.textContent = message;
    notification.classList.remove('think-first-hidden');
    
    setTimeout(() => {
      notification.classList.add('think-first-hidden');
    }, duration);
  }
}

function showIntervention(promptValue, reason = null) {
  debugLog('Showing intervention for prompt:', promptValue);
  const overlay = document.getElementById('think-first-overlay');
  if (!overlay) {
    debugLog('Warning: Intervention overlay not found');
    injectUI();
    return;
  }
  
  interventionActive = true;
  setPendingIntervention(promptValue, reason);
  document.body.classList.add('think-first-active');
  overlay.className = 'think-first-overlay';
  
  const thinkingPrompt = document.getElementById('think-first-thinking-prompt');
  thinkingPrompt.innerHTML = `
    <h3>Think First!</h3>
    <div class="think-first-prompt-preview">
      "${promptValue}"
    </div>
    ${reason ? `<p class="think-first-reason" style="color: #e67e22; font-style: italic; margin: 8px 0;">Reason: ${reason.reason || ''}</p>` : ''}
    <div class="think-first-questions">
      <p>Break down the problem into smaller parts</p>
      <p>Outline your current understanding</p>
      <p>Try solving the simplest part first</p>
      <p>List specific concepts you need help with</p>
    </div>
    ${reason && reason.suggestedPrompt ? `
      <div class="think-first-suggestion">
        <h4>Try this learning-focused approach:</h4>
        <div class="think-first-prompt-suggestion">
          "${reason.suggestedPrompt}"
        </div>
        <button id="think-first-use-suggestion" class="think-first-button-secondary">
          Use this learning-focused prompt
        </button>
      </div>
    ` : ''}
  `;

  const suggestionButton = document.getElementById('think-first-use-suggestion');
  if (suggestionButton) {
    suggestionButton.addEventListener('click', async () => {
      const suggestedPrompt = reason.suggestedPrompt;
      
      try {
        await navigator.clipboard.writeText(suggestedPrompt);
        
        await new Promise(resolve => {
          chrome.storage.local.set({
            'showCopiedNotification': true
          }, resolve);
        });
        
        window.location.href = 'https://chat.openai.com/';
        
        clearPendingIntervention();
        
        interventionActive = false;
        promptText = "";
        lastKnownValue = "";
        lastSubmittedValue = "";
        pendingSubmission = null;
      } catch (err) {
        debugLog('Error copying to clipboard:', err);
        showNotification('❌ Failed to copy prompt to clipboard');
      }
    });
  }
}

async function checkNotificationFlag() {
  try {
    const data = await new Promise(resolve => {
      chrome.storage.local.get(['showCopiedNotification'], resolve);
    });
    
    if (data.showCopiedNotification) {
      showNotification('✨ Learning-focused prompt copied to clipboard');
      chrome.storage.local.remove('showCopiedNotification');
    }
  } catch (err) {
    debugLog('Error checking notification flag:', err);
  }
}

function initialize() {
  if (isSetup) {
    debugLog('Already initialized, but will verify setup');
    
    // Verify that we are still properly connected to events
    // Sometimes ChatGPT can replace elements without triggering mutation observers
    const textarea = document.querySelector(chatgptSelectors.textarea);
    if (!textarea) {
      debugLog('Textarea missing after initialization, re-initializing');
      isSetup = false;
    }
  }

  if (!isSetup) {
    try {
      debugLog('Initializing ThinkFirst extension');
      injectUI();
      monitorInputs();
      checkPendingIntervention();
      checkNotificationFlag();
      
      // Add visibility change listener to refresh state when tab becomes visible again
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          debugLog('Tab visibility changed to visible, refreshing state');
          // Re-check our initialization when tab becomes visible
          if (!document.querySelector(chatgptSelectors.textarea)) {
            debugLog('Textarea not found after visibility change, re-initializing');
            isSetup = false;
            initialize();
          }
          
          safeSendMessage({ action: "getState" }).then(response => {
            if (response && response.state) {
              // Update the state in UI, even if settings panel is closed
              updateSettingsPanel();
            }
          });
        }
      });
      
      // Monitor URL changes and re-initialize if needed
      let lastUrl = location.href; 
      new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
          lastUrl = url;
          debugLog('URL changed, re-initializing');
          isSetup = false;
          monitorInputs();
          checkPendingIntervention();
          checkNotificationFlag();
        }
      }).observe(document, {subtree: true, childList: true});
      
      // Additional recovery: periodically check if our textarea element is still valid
      setInterval(() => {
        const textarea = document.querySelector(chatgptSelectors.textarea);
        if (!textarea && isSetup) {
          debugLog('Periodic check found missing textarea, re-initializing');
          isSetup = false;
          initialize();
        }
      }, 5000);
    } catch (err) {
      debugLog('Error during initialization:', err);
      isSetup = false;
      
      // Try to recover from initialization errors
      setTimeout(() => {
        debugLog('Attempting to recover from initialization error');
        initialize();
      }, 3000);
    }
  }

  // Add global click handler to catch submit button clicks that might be missed
  document.addEventListener('click', (e) => {
    // Check if the clicked element or any of its parents is the send button
    let target = e.target;
    let sendButton = null;
    
    while (target) {
      if (target.matches && target.matches(chatgptSelectors.sendButton)) {
        sendButton = target;
        break;
      }
      target = target.parentElement;
    }

    if (sendButton) {
      debugLog('Global click handler caught submit button click');
      const textarea = document.querySelector(chatgptSelectors.textarea);
      if (textarea) {
        const currentValue = getInputValue(textarea);
        if (currentValue && currentValue !== lastSubmittedPrompt) {
          debugLog('Logging prompt from global click handler');
          
          // Track that we have a submission in progress
          lastSubmittedPrompt = currentValue;
          lastSubmissionTimestamp = Date.now();
          
          // Fire and forget - don't block or interfere with the normal click behavior
          setTimeout(() => {
            safeSendMessage({
              action: "promptDetected",
              promptText: currentValue,
              site: siteDetected
            }).catch(err => {
              debugLog('Error in global click handler:', err);
            });
          }, 0);
        }
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

function monitorInputs() {
  debugLog('Setting up input monitoring');
  
  function waitForTextarea() {
    return new Promise((resolve) => {
      // First check if textarea exists immediately
      const textarea = document.querySelector(chatgptSelectors.textarea);
      if (textarea) {
        resolve(textarea);
        return;
      }

      // Otherwise set up an interval to keep checking
      const checkInterval = setInterval(() => {
        const textarea = document.querySelector(chatgptSelectors.textarea);
        if (textarea) {
          clearInterval(checkInterval);
          resolve(textarea);
        }
      }, 100);

      // Set timeout to resolve with null if textarea not found within 10 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(null);
      }, 10000);
    });
  }

  const inputHandler = (e) => {
    const value = getInputValue(e.target);
    if (value) {
      lastKnownValue = value;
      promptText = value;
      lastSubmittedValue = value; 
      debugLog('Input value updated:', value);
    }
  };

  const keydownHandler = async (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      const currentValue = getInputValue(e.target);
      if (currentValue) {
        lastKnownValue = currentValue;
        promptText = currentValue;
        lastSubmittedValue = currentValue;
      }
      
      if (inputDebounceTimeout) {
        clearTimeout(inputDebounceTimeout);
      }
      inputDebounceTimeout = setTimeout(async () => {
        await handleSubmission(e, e.target);
      }, 100);
    }
  };

  const clickHandler = async (e) => {
    // Don't prevent default or stop propagation, as this blocks the normal submission
    // e.preventDefault();
    // e.stopPropagation();
    
    const input = document.querySelector(chatgptSelectors.textarea);
    if (input) {
      const currentValue = getInputValue(input);
      if (currentValue) {
        lastKnownValue = currentValue;
        promptText = currentValue;
        lastSubmittedValue = currentValue;
        debugLog('Send button click detected with value:', currentValue);
      }
    }
    
    if (inputDebounceTimeout) {
      clearTimeout(inputDebounceTimeout);
    }
    
    // Process our logic but don't block the default click behavior
    // This allows the form to submit naturally while we still do our tracking
    handleSubmission(e, input).catch(err => {
      debugLog('Error in click handler:', err);
    });
    
    // Let the event continue normally
    return true;
  };

  const formSubmitHandler = async (e) => {
    // If this is an event we've already processed, let it through
    if (e.allowSubmit) {
      return true;
    }
    
    const input = document.querySelector(chatgptSelectors.textarea);
    if (input) {
      const currentValue = getInputValue(input);
      if (currentValue) {
        lastKnownValue = currentValue;
        promptText = currentValue;
        lastSubmittedValue = currentValue;
        debugLog('Form submission detected with value:', currentValue);
      }
    }
    
    // Instead of awaiting and potentially blocking, fire and forget our logic
    // This prevents our processing from delaying the actual form submission
    handleSubmission(e, input).catch(err => {
      debugLog('Error in form submit handler:', err);
    });
    
    // We'll only stop propagation if our handleSubmission triggers an intervention,
    // otherwise let the form submit as normal
    return !interventionActive;
  };

  async function setupInputMonitoring() {
    if (isSetup) {
      return; 
    }

    debugLog('Running setupInputMonitoring');
    
    // Get the ChatGPT input element
    const chatgptInput = await waitForTextarea();
    if (!chatgptInput) {
      debugLog('Textarea not found after waiting, will retry on DOM changes');
      isSetup = false;
      return;
    }

    // Find send button and form
    const chatgptSendBtn = document.querySelector(chatgptSelectors.sendButton);
    const chatgptForm = chatgptInput.form;

    debugLog('Found ChatGPT elements:', { 
      hasInput: !!chatgptInput, 
      hasSendBtn: !!chatgptSendBtn,
      hasForm: !!chatgptForm,
      currentInputValue: getInputValue(chatgptInput)
    });

    // Remove existing event listeners to prevent duplicates
    chatgptInput.removeEventListener('input', inputHandler);
    chatgptInput.removeEventListener('keydown', keydownHandler);
    if (chatgptSendBtn) {
      chatgptSendBtn.removeEventListener('click', clickHandler);
    }
    if (chatgptForm) {
      chatgptForm.removeEventListener('submit', formSubmitHandler, true);
      if (chatgptForm.onsubmit) {
        originalSubmitHandler = chatgptForm.onsubmit;
      }
      
      // Override the form's submit method
      if (chatgptForm.submit && typeof chatgptForm.submit === 'function') {
        const originalSubmit = chatgptForm.submit;
        chatgptForm.submit = function() {
          if (interventionActive) {
            debugLog('Blocking direct form.submit() call');
            return false;
          }
          
          // Capture current input value before submission
          const currentValue = getInputValue(chatgptInput);
          if (currentValue) {
            lastKnownValue = currentValue;
            promptText = currentValue;
            lastSubmittedValue = currentValue;
            debugLog('Form direct submit with value:', currentValue);
            
            // Log the prompt detection - ensures it's always logged even with unusual submission methods
            safeSendMessage({
              action: "promptDetected",
              promptText: currentValue,
              site: siteDetected
            });
          }
          
          return originalSubmit.apply(this, arguments);
        };
      }
    }

    // Add event listeners
    chatgptInput.addEventListener('input', inputHandler);
    chatgptInput.addEventListener('keydown', keydownHandler);
    chatgptInput.addEventListener('paste', (e) => {
      setTimeout(() => {
        const value = getInputValue(e.target);
        if (value) {
          lastKnownValue = value;
          promptText = value;
          lastSubmittedValue = value;
          debugLog('Paste value captured:', value);
        }
      }, 0);
    });
    
    if (chatgptSendBtn) {
      chatgptSendBtn.addEventListener('click', clickHandler);
    }
    
    if (chatgptForm) {
      chatgptForm.addEventListener('submit', formSubmitHandler, true);
    }

    isSetup = true;
    debugLog('Input monitoring setup complete');
  }

  setupInputMonitoring();

  let setupTimeout = null;
  const observer = new MutationObserver((mutations) => {
    // Check if the relevant elements have been added or removed
    const shouldRerun = mutations.some(mutation => {
      // Check for added nodes that might be our target elements
      const hasAddedRelevantNodes = Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.matches?.(chatgptSelectors.textarea) || 
                 node.matches?.(chatgptSelectors.sendButton) || 
                 node.matches?.('form') || 
                 node.querySelector?.(chatgptSelectors.textarea) ||
                 node.querySelector?.(chatgptSelectors.sendButton);
        }
        return false;
      });
      
      // Check if target elements were removed - requiring reinstallation of listeners
      const hasRemovedRelevantNodes = Array.from(mutation.removedNodes).some(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.matches?.(chatgptSelectors.textarea) || 
                 node.matches?.(chatgptSelectors.sendButton) || 
                 node.matches?.('form') || 
                 node.querySelector?.(chatgptSelectors.textarea) ||
                 node.querySelector?.(chatgptSelectors.sendButton);
        }
        return false;
      });
      
      return hasAddedRelevantNodes || hasRemovedRelevantNodes;
    });

    // If ChatGPT's textarea or submit button has been added/removed, we need to rerun setup
    if (shouldRerun) {
      isSetup = false;
      if (setupTimeout) {
        clearTimeout(setupTimeout);
      }
      setupTimeout = setTimeout(() => {
        debugLog('Relevant DOM changes detected, re-running setup');
        setupInputMonitoring();
      }, 300);
    }
  });

  // Observe for changes to any element in the body, since ChatGPT's UI is dynamic
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function promptTextSeemsLazy(text) {
  if (!text) return false;
  
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
    /write a function.*that/i, 
    /function.*takes.*returns/i,
    /generate a/i,
    /implement a/i,
    /build me/i,
    /write an essay/i,
    /write a story/i,
    /finish this/i,
    /answer the following/i,
    /summarize this/i
  ];
  
  const isLazy = lazyPatterns.some(pattern => pattern.test(text));
  debugLog('Lazy check result:', { text, isLazy });
  return isLazy;
}

function isGoodThinkingPrompt(text) {
  if (!text) return false;
  
  const goodPatterns = [
    /can you explain/i,
    /help me understand/i,
    /what are the principles/i,
    /how does.*work/i,
    /why does.*happen/i,
    /what is the concept/i,
    /break down/i,
    /step by step/i,
    /clarify/i,
    /difference between/i,
    /compare and contrast/i,
    /reasoning behind/i,
    /thought process/i,
    /best practices/i,
    /help me learn/i,
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
  
  return goodPatterns.some(pattern => pattern.test(text));
}

function showBrainCelebration() {
  const brainIcon = document.getElementById('think-first-brain');
  if (brainIcon) {
    brainIcon.classList.add('celebrate');
    
    const sparkleContainer = document.createElement('div');
    sparkleContainer.className = 'brain-sparkle-container';
    
    for (let i = 0; i < 4; i++) {
      const sparkle = document.createElement('div');
      sparkle.className = 'brain-sparkle';
      sparkle.textContent = '✨';
      sparkleContainer.appendChild(sparkle);
    }
    
    document.body.appendChild(sparkleContainer);
    
    setTimeout(() => {
      brainIcon.classList.remove('celebrate');
      sparkleContainer.remove();
    }, 1500);
  }
}

async function handleSubmission(e, input) {
  // Only prevent default and stop propagation if we're intervening
  // This allows normal submission flow in all other cases
  if (interventionActive) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    return false;
  }

  if (isSubmitting) {
    debugLog('Already processing a submission, ignoring duplicate');
    return true;
  }

  isSubmitting = true;

  try {
    const currentValue = getInputValue(input);
    const valueToUse = currentValue || lastKnownValue || lastSubmittedValue || pendingSubmission;
    
    debugLog('Handling submission:', {
      currentValue,
      lastKnownValue,
      lastSubmittedValue,
      pendingSubmission,
      valueToUse
    });
    
    if (!valueToUse) {
      debugLog('No value to submit');
      return true; // Allow submission anyway
    }

    const now = Date.now();
    
    // Don't block submission for duplicates, just don't log them twice
    const isDuplicate = valueToUse === lastSubmittedPrompt && (now - lastSubmissionTimestamp) < 2000;
    if (isDuplicate) {
      debugLog('Duplicate submission detected, won\'t log twice but allowing submission');
      return true;
    } 

    // Always update these values for non-duplicate submissions
    lastSubmittedPrompt = valueToUse;
    lastSubmissionTimestamp = now;
    
    // Log the prompt - we do this regardless of analysis to ensure consistent tracking
    // Use a fire-and-forget approach to avoid blocking the UI
    safeSendMessage({
      action: "promptDetected",
      promptText: valueToUse,
      site: siteDetected
    }).catch(err => {
      debugLog('Error logging prompt:', err);
    });

    try {
      const stateResponse = await safeSendMessage({ action: "getState" });
      if (!stateResponse || !stateResponse.state) {
        throw new Error('Failed to get state');
      }
      const currentState = stateResponse.state;

      // Intervention modes need to block submission
      if (currentState.mode === 'strict') {
        debugLog('Strict mode: showing intervention for all prompts');
        pendingSubmission = valueToUse;
        interventionActive = true;
        showIntervention(valueToUse, {
          isLazy: false,
          isLearning: false,
          reason: "You are in strict mode. All prompts require reflection before submission."
        });
        
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        return false;
      }
      
      // Relaxed mode passes through
      if (currentState.mode === 'relaxed') {
        debugLog('Relaxed mode: Using local pattern matching instead of AI API');
        
        if (isGoodThinkingPrompt(valueToUse)) {
          debugLog('Good thinking prompt detected via pattern matching!');
          showBrainCelebration();
          showNotification('🌟 Great question! Keep thinking deeply!');
          chrome.runtime.sendMessage({ 
            action: "logThinking", 
            points: 2 
          });
        }
        
        return true; // Allow submission in relaxed mode
      }

      // Check for lazy prompts
      const result = await safeSendMessage({
        action: "analyzePrompt",
        text: valueToUse
      });
      
      if (result && result.analysis) {
        debugLog('AI analysis result:', result.analysis);
        
        if (result.analysis.isLearning) {
          debugLog('Learning-focused prompt detected!');
          showBrainCelebration();
          showNotification('🌟 Great question! Keep thinking deeply!');
          chrome.runtime.sendMessage({ 
            action: "logThinking", 
            points: 2 
          });
        }
        
        if (currentState.mode === 'normal' && result.analysis.isLazy) {
          debugLog('Intervention needed based on AI analysis');
          pendingSubmission = valueToUse;
          interventionActive = true;
          showIntervention(valueToUse, result.analysis);
          
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          return false;
        }
      }
      
      return true; // Allow submission by default
    } catch (err) {
      debugLog('AI analysis failed, falling back to pattern matching:', err);
      
      // Try to get state, but don't block if it fails
      let currentState = { mode: 'normal' };
      try {
        const stateResponse = await safeSendMessage({ action: "getState" });
        if (stateResponse && stateResponse.state) {
          currentState = stateResponse.state;
        }
      } catch (stateErr) {
        debugLog('Failed to get state:', stateErr);
      }
      
      if (isGoodThinkingPrompt(valueToUse)) {
        debugLog('Good thinking prompt detected via pattern matching!');
        showBrainCelebration();
        showNotification('🌟 Great question! Keep thinking deeply!');
        chrome.runtime.sendMessage({ 
          action: "logThinking", 
          points: 2 
        });
      }
      
      const isLazyPrompt = promptTextSeemsLazy(valueToUse);
      if (isLazyPrompt && (currentState.mode === 'strict' || currentState.mode === 'normal')) {
        debugLog('Intervention needed based on pattern matching');
        pendingSubmission = valueToUse;
        interventionActive = true;
        showIntervention(valueToUse, {
          isLazy: true,
          reason: 'This prompt matches patterns of lazy AI usage'
        });
        
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        return false;
      }
      
      return true; // Allow submission if no intervention needed
    }
  } finally {
    // Reset submission flag after a delay to prevent rapid repeated submissions
    setTimeout(() => {
      isSubmitting = false;
    }, 500);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "interventionRequired") {
    showIntervention(request.prompt, request.reason);
    sendResponse({ received: true });
    return false;
  } else if (request.action === "thinkingPointsEarned") {
    showPointsAnimation(request.points);
    pulseBrainIcon();
    showNotification(`Earned ${request.points} thinking points! 🧠`);
    sendResponse({ received: true });
    return false;
  }
});

function showPointsAnimation(points) {
  const pointsElement = document.createElement('div');
  pointsElement.className = 'points-animation';
  pointsElement.textContent = `+${points} 🧠`;
  document.body.appendChild(pointsElement);
  
  setTimeout(() => {
    pointsElement.remove();
  }, 1500);
}

function pulseBrainIcon() {
  const brainIcon = document.getElementById('think-first-brain');
  if (brainIcon) {
    brainIcon.classList.add('pulse');
    setTimeout(() => {
      brainIcon.classList.remove('pulse');
    }, 1000);
  }
}

function animateStatUpdate(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.classList.add('updating');
    setTimeout(() => {
      element.classList.remove('updating');
    }, 500);
  }
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(num => parseInt(num, 10));
  return new Date(year, month - 1, day);
}

function createSettingsUsageChart(data) {
  const canvas = document.getElementById('settings-usage-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (window.settingsUsageChart) {
    window.settingsUsageChart.destroy();
  }

  // Get today's date
  const today = new Date();
  const todayDateStr = formatLocalDate(today);

  const processedData = data.map(entry => {
    const [year, month, day] = entry.date.split('-').map(num => parseInt(num, 10));
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

  console.log('Settings Chart data:', {
    rawDates: lastWeekData.map(d => d.date),
    formattedDates: dates,
    counts,
    today: todayDateStr
  });

  window.settingsUsageChart = new Chart(ctx, {
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
      },
      layout: {
        padding: {
          left: 5,
          right: 5,
          top: 10,
          bottom: 5
        }
      }
    }
  });
}
  