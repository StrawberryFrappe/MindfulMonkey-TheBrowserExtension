// Mindful Monkey - Background Service Worker
// Tracks time spent on domain groups and redirects when limits exceeded

const DEFAULT_LIMIT_MINUTES = 120; // 2 hours
const URL_LIST = [
    'https://en.wikipedia.org/wiki/Special:Random', 
    'https://archive.org/',
    'https://openlibrary.org/explore',
    'https://web.archive.org/'
];
//
//
// ========== DATA MANAGEMENT ==========

async function getData() {
    const result = await chrome.storage.local.get(['groups', 'lastResetDate']);
    return {
        groups: result.groups || {},
        lastResetDate: result.lastResetDate || null
    };
}

async function saveData(data) {
    await chrome.storage.local.set(data);
}

// ========== DAILY RESET LOGIC ==========

function getTodayDateString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function checkAndPerformDailyReset() {
    const data = await getData();
    const today = getTodayDateString();

    if (data.lastResetDate !== today) {
        // Reset all timers and apply pending changes
        const groupIds = Object.keys(data.groups);
        for (const groupId of groupIds) {
            const group = data.groups[groupId];
            
            // Apply pending deletions first
            if (group.pendingDeletion) {
                delete data.groups[groupId];
                continue;
            }

            group.usedMinutes = 0;

            // Apply pending limit changes
            if (group.pendingLimitMinutes !== null && group.pendingLimitMinutes !== undefined) {
                group.limitMinutes = group.pendingLimitMinutes;
                group.pendingLimitMinutes = null;
            }
        }

        data.lastResetDate = today;
        await saveData(data);
        console.log('[Mindful Monkey] Daily reset performed');
    }
}

// Schedule daily reset check using alarms
async function setupDailyResetAlarm() {
    // Clear existing alarms
    await chrome.alarms.clear('dailyReset');

    // Calculate time until next midnight
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    // Create alarm for midnight
    chrome.alarms.create('dailyReset', {
        when: Date.now() + msUntilMidnight,
        periodInMinutes: 24 * 60 // Repeat every 24 hours
    });

    console.log('[Mindful Monkey] Daily reset alarm set for', midnight.toLocaleString());
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'dailyReset') {
        await checkAndPerformDailyReset();
    }
});

// ========== TIME TRACKING ==========

let activeTabInfo = null;
let trackingInterval = null;

function getDomainFromUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

function findGroupForDomain(groups, domain) {
    if (!domain) return null;

    for (const groupId in groups) {
        const group = groups[groupId];
        for (const groupDomain of group.domains) {
            // Match exact domain or subdomain
            const cleanGroupDomain = groupDomain.replace(/^www\./, '');
            if (domain === cleanGroupDomain || domain.endsWith('.' + cleanGroupDomain)) {
                return groupId;
            }
        }
    }
    return null;
}

async function updateActiveTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab && tab.url) {
            const domain = getDomainFromUrl(tab.url);
            const data = await getData();
            const groupId = findGroupForDomain(data.groups, domain);

            if (groupId) {
                activeTabInfo = { domain, groupId, tabId: tab.id };
            } else {
                activeTabInfo = null;
            }
        } else {
            activeTabInfo = null;
        }
    } catch (e) {
        activeTabInfo = null;
    }
}

async function trackTime() {
    if (!activeTabInfo) return;

    const data = await getData();
    const group = data.groups[activeTabInfo.groupId];

    if (group) {
        const wasUnderLimit = !isGroupOverLimit(group);

        // Add 1 second (1/60 of a minute)
        group.usedMinutes = (group.usedMinutes || 0) + (1 / 60);

        // Check if timer just expired
        const isNowOverLimit = isGroupOverLimit(group);

        await saveData(data);

        // If timer just ended and user is still on the domain, reload to trigger blockage
        if (wasUnderLimit && isNowOverLimit && activeTabInfo.tabId) {
            console.log(`[Mindful Monkey] Timer expired for ${activeTabInfo.domain}, reloading tab to activate blockage`);
            chrome.tabs.reload(activeTabInfo.tabId);
        }
    }
}

function startTracking() {
    if (trackingInterval) return;

    trackingInterval = setInterval(async () => {
        await updateActiveTab();
        await trackTime();
    }, 1000); // Update every second

    console.log('[Mindful Monkey] Time tracking started');
}

// ========== REDIRECT LOGIC ==========

function isGroupOverLimit(group) {
    return (group.usedMinutes || 0) >= group.limitMinutes;
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    // Only handle main frame navigations
    if (details.frameId !== 0) return;

    const domain = getDomainFromUrl(details.url);
    if (!domain) return;

    const data = await getData();
    const groupId = findGroupForDomain(data.groups, domain);

    if (groupId) {
        const group = data.groups[groupId];
        if (isGroupOverLimit(group)) {
            // Redirect to random Page from list
            chrome.tabs.update(details.tabId, { url: URL_LIST[Math.floor(Math.random()*URL_LIST.length)] });
            console.log(`[Mindful Monkey] Redirected ${domain} to Wikipedia (limit exceeded)`);
        }
    }
});

// ========== TAB EVENT LISTENERS ==========

chrome.tabs.onActivated.addListener(async () => {
    await updateActiveTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
        await updateActiveTab();
    }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        activeTabInfo = null;
    } else {
        await updateActiveTab();
    }
});

// ========== MESSAGE HANDLING (for popup) ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_DATA') {
        getData().then(sendResponse);
        return true; // Async response
    }

    if (message.type === 'CREATE_GROUP') {
        (async () => {
            const data = await getData();
            const groupId = message.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
            data.groups[groupId] = {
                name: message.name,
                domains: message.domains,
                limitMinutes: message.limitMinutes || DEFAULT_LIMIT_MINUTES,
                usedMinutes: 0,
                pendingLimitMinutes: null,
                pendingDeletion: false
            };
            await saveData(data);
            sendResponse({ success: true, groupId });
        })();
        return true;
    }

    if (message.type === 'UPDATE_GROUP_DOMAINS') {
        (async () => {
            const data = await getData();
            if (data.groups[message.groupId]) {
                data.groups[message.groupId].domains = message.domains;
                await saveData(data);
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Group not found' });
            }
        })();
        return true;
    }

    if (message.type === 'UPDATE_GROUP_LIMIT') {
        (async () => {
            const data = await getData();
            if (data.groups[message.groupId]) {
                // Queue the change for next day
                data.groups[message.groupId].pendingLimitMinutes = message.limitMinutes;
                await saveData(data);
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Group not found' });
            }
        })();
        return true;
    }

    if (message.type === 'DELETE_GROUP') {
        (async () => {
            const data = await getData();
            if (data.groups[message.groupId]) {
                data.groups[message.groupId].pendingDeletion = true;
                await saveData(data);
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Group not found' });
            }
        })();
        return true;
    }

    if (message.type === 'CANCEL_DELETE_GROUP') {
        (async () => {
            const data = await getData();
            if (data.groups[message.groupId]) {
                data.groups[message.groupId].pendingDeletion = false;
                await saveData(data);
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Group not found' });
            }
        })();
        return true;
    }
});

// ========== INITIALIZATION ==========

async function init() {
    console.log('[Mindful Monkey] Extension starting...');
    await checkAndPerformDailyReset();
    await setupDailyResetAlarm();
    startTracking();
    console.log('[Mindful Monkey] Extension ready');
}

init();
