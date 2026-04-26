// Mindful Monkey - Popup Script

document.addEventListener('DOMContentLoaded', () => {
    const groupsContainer = document.getElementById('groups-container');
    const addGroupBtn = document.getElementById('add-group-btn');
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalClose = document.getElementById('modal-close');
    const groupForm = document.getElementById('group-form');
    const editGroupId = document.getElementById('edit-group-id');
    const groupName = document.getElementById('group-name');
    const groupDomains = document.getElementById('group-domains');
    const groupLimitHours = document.getElementById('group-limit-hours');
    const groupLimitMinutes = document.getElementById('group-limit-minutes');
    const pendingNotice = document.getElementById('pending-notice');
    const deleteGroupBtn = document.getElementById('delete-group-btn');

    let currentData = { groups: {} };
    let refreshInterval = null;

    // ========== DATA LOADING ==========

    async function loadData() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'GET_DATA' }, (response) => {
                currentData = response || { groups: {} };
                resolve(currentData);
            });
        });
    }

    // ========== RENDERING ==========

    function formatDigitalTime(minutes) {
        const totalSeconds = Math.max(0, Math.floor(minutes * 60));
        const hrs = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;

        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function renderGroups() {
        const groups = currentData.groups;
        const groupIds = Object.keys(groups);

        if (groupIds.length === 0) {
            groupsContainer.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🐵</div>
                    <p>No domain groups yet.<br>Add one to start tracking!</p>
                </div>
            `;
            return;
        }

        groupsContainer.innerHTML = groupIds.map(groupId => {
            const group = groups[groupId];
            const usedMinutes = group.usedMinutes || 0;
            const limitMinutes = group.limitMinutes || 120;
            const exceeded = usedMinutes >= limitMinutes;
            const hasPendingLimit = group.pendingLimitMinutes !== null && group.pendingLimitMinutes !== undefined;
            const isPendingDeletion = group.pendingDeletion === true;

            const remainingMinutes = Math.max(0, limitMinutes - usedMinutes);
            const digitalTime = formatDigitalTime(remainingMinutes);

            const limitHours = Math.floor(limitMinutes / 60);
            const limitMins = Math.round(limitMinutes % 60);
            const limitText = limitHours > 0 ? `${limitHours}h ${limitMins}m` : `${limitMins}m`;

            return `
                <div class="group-card ${exceeded ? 'exceeded' : ''} ${isPendingDeletion ? 'pending-deletion' : ''}" data-group-id="${groupId}">
                    ${isPendingDeletion ? '<span class="pending-badge delete">Pending deletion</span>' : (hasPendingLimit ? '<span class="pending-badge">Pending limit change</span>' : '')}
                    <div class="group-header">
                        <span class="group-name">${escapeHtml(group.name)}</span>
                        <span class="group-status ${exceeded ? 'exceeded' : 'active'}">
                            ${exceeded ? '🚫 Blocked' : '✓ Active'}
                        </span>
                    </div>
                    <div class="clock-container">
                        <div class="digital-clock ${exceeded ? 'exceeded' : ''}">${digitalTime}</div>
                    </div>
                    <div class="time-info">
                        <span>Daily Limit: ${limitText}</span>
                        <span>${exceeded ? 'Time\'s up!' : 'Remaining'}</span>
                    </div>
                    <div class="domains-preview">${group.domains.map(d => escapeHtml(d)).join(', ')}</div>
                </div>
            `;
        }).join('');

        // Add click handlers
        document.querySelectorAll('.group-card').forEach(card => {
            card.addEventListener('click', () => {
                openEditModal(card.dataset.groupId);
            });
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== MODAL HANDLING ==========

    function openAddModal() {
        modalTitle.textContent = 'Add Domain Group';
        editGroupId.value = '';
        groupName.value = '';
        groupName.disabled = false;
        groupDomains.value = '';
        groupLimitHours.value = '2';
        groupLimitMinutes.value = '0';
        pendingNotice.classList.add('hidden');
        deleteGroupBtn.classList.add('hidden');
        modal.classList.remove('hidden');
    }

    function openEditModal(groupId) {
        const group = currentData.groups[groupId];
        if (!group) return;

        modalTitle.textContent = 'Edit Domain Group';
        editGroupId.value = groupId;
        groupName.value = group.name;
        groupName.disabled = true; // Can't rename
        groupDomains.value = group.domains.join('\n');

        const limitMins = group.limitMinutes || 120;
        groupLimitHours.value = Math.floor(limitMins / 60);
        groupLimitMinutes.value = Math.round(limitMins % 60);

        // Show pending notice for existing groups
        if (group.pendingDeletion) {
            pendingNotice.textContent = 'Scheduled for deletion tomorrow.';
            pendingNotice.className = 'pending-notice notice warning';
            deleteGroupBtn.textContent = 'Cancel Deletion';
            deleteGroupBtn.className = 'btn secondary';
            pendingNotice.classList.remove('hidden');
        } else if (group.pendingLimitMinutes !== null && group.pendingLimitMinutes !== undefined) {
            pendingNotice.textContent = 'Time limit changes will take effect tomorrow.';
            pendingNotice.className = 'pending-notice notice info';
            deleteGroupBtn.textContent = 'Delete Group';
            deleteGroupBtn.className = 'btn danger';
            pendingNotice.classList.remove('hidden');
        } else {
            pendingNotice.classList.add('hidden');
            deleteGroupBtn.textContent = 'Delete Group';
            deleteGroupBtn.className = 'btn danger';
        }

        deleteGroupBtn.classList.remove('hidden');
        modal.classList.remove('hidden');
    }

    function closeModal() {
        modal.classList.add('hidden');
    }

    // ========== EVENT HANDLERS ==========

    addGroupBtn.addEventListener('click', openAddModal);
    modalClose.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    groupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const domains = groupDomains.value
            .split('\n')
            .map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
            .filter(d => d.length > 0);

        if (domains.length === 0) {
            alert('Please enter at least one domain');
            return;
        }

        const limitMinutes = (parseInt(groupLimitHours.value) || 0) * 60 + (parseInt(groupLimitMinutes.value) || 0);

        if (limitMinutes < 1) {
            alert('Time limit must be at least 1 minute');
            return;
        }

        const isEdit = editGroupId.value !== '';

        if (isEdit) {
            // Update domains immediately
            await new Promise(resolve => {
                chrome.runtime.sendMessage({
                    type: 'UPDATE_GROUP_DOMAINS',
                    groupId: editGroupId.value,
                    domains: domains
                }, resolve);
            });

            // Queue limit change for next day
            const existingLimit = currentData.groups[editGroupId.value]?.limitMinutes || 120;
            if (limitMinutes !== existingLimit) {
                await new Promise(resolve => {
                    chrome.runtime.sendMessage({
                        type: 'UPDATE_GROUP_LIMIT',
                        groupId: editGroupId.value,
                        limitMinutes: limitMinutes
                    }, resolve);
                });
            }
        } else {
            // Create new group
            await new Promise(resolve => {
                chrome.runtime.sendMessage({
                    type: 'CREATE_GROUP',
                    name: groupName.value.trim(),
                    domains: domains,
                    limitMinutes: limitMinutes
                }, resolve);
            });
        }

        closeModal();
        await loadData();
        renderGroups();
    });

    deleteGroupBtn.addEventListener('click', async () => {
        if (!editGroupId.value) return;

        const group = currentData.groups[editGroupId.value];
        if (!group) return;

        if (group.pendingDeletion) {
            // Cancel deletion
            await new Promise(resolve => {
                chrome.runtime.sendMessage({
                    type: 'CANCEL_DELETE_GROUP',
                    groupId: editGroupId.value
                }, resolve);
            });
            closeModal();
            await loadData();
            renderGroups();
        } else {
            // Confirm deletion
            if (confirm(`Queue "${group.name}" for deletion? This will take effect tomorrow.`)) {
                await new Promise(resolve => {
                    chrome.runtime.sendMessage({
                        type: 'DELETE_GROUP',
                        groupId: editGroupId.value
                    }, resolve);
                });

                closeModal();
                await loadData();
                renderGroups();
            }
        }
    });

    // ========== AUTO REFRESH ==========

    async function refresh() {
        await loadData();
        renderGroups();
    }

    // ========== INITIALIZATION ==========

    async function init() {
        await refresh();
        // Refresh every 1 second to update seconds on clock
        refreshInterval = setInterval(refresh, 1000);
    }

    // Cleanup on popup close
    window.addEventListener('unload', () => {
        if (refreshInterval) clearInterval(refreshInterval);
    });

    init();
});
