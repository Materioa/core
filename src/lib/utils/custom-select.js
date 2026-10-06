/**
 * Custom Select Module (ESM)
 * Global modal dropdown wizard for reading card selects (#semesterSelect, #subjectSelect, #categorySelect, #topicSelect)
 * Intercepts native select taps and shows a styled promo-modal with wizard navigation.
 */

const SELECT_ORDER = ['semesterSelect', 'subjectSelect', 'categorySelect', 'topicSelect'];
const SELECT_LABELS = {
  semesterSelect: 'Select Semester',
  subjectSelect: 'Select Subject',
  categorySelect: 'Select Category',
  topicSelect: 'Select Topic'
};

let modal = null;
let backdrop = null;
let currentStepIndex = 0;
let closeTimeout = null;
let lastTriggeredTime = 0;
let isInitialized = false;

function isMobile() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768;
}

function createModal() {
  if (typeof document === 'undefined') return;
  if (modal) return;

  backdrop = document.createElement('div');
  backdrop.className = 'promo-modal-overlay custom-select-backdrop';
  backdrop.style.zIndex = '9999';
  backdrop.style.display = 'none';
  backdrop.style.opacity = '0';
  backdrop.addEventListener('click', (e) => {
    const openedTime = parseInt(backdrop.dataset.openedTime || '0', 10);
    if (e.target === backdrop && Date.now() - openedTime > 400) {
      closeModal();
    }
  });

  modal = document.createElement('div');
  modal.className = 'promo-modal custom-select-promo';
  modal.style.maxWidth = '450px';
  modal.style.width = '90%';
  modal.style.maxHeight = '85vh';

  modal.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" class="promo-close-btn" style="z-index:10; cursor:pointer;" onclick="document.querySelector('.custom-select-backdrop').click()"><path d="M19.0005 4.99988L5.00049 18.9999M5.00049 4.99988L19.0005 18.9999" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>
    <div class="promo-content custom-select-wizard-container" style="width: 100%; box-sizing: border-box; position: relative; min-height: 350px;">
      <!-- The wizard view will be injected here -->
    </div>
  `;

  if (!document.getElementById('custom-select-scrollbar-styles')) {
    const style = document.createElement('style');
    style.id = 'custom-select-scrollbar-styles';
    style.textContent = `
          .custom-select-options {
              scrollbar-width: thin !important;
              scrollbar-color: rgba(0, 0, 0, 0.2) transparent !important;
          }
          body.dark-mode .custom-select-options {
              scrollbar-color: rgba(255, 255, 255, 0.2) transparent !important;
          }
          .custom-select-options::-webkit-scrollbar {
              width: 6px !important;
              display: block !important;
              -webkit-appearance: none !important;
          }
          .custom-select-options::-webkit-scrollbar-track {
              background: transparent !important;
          }
          .custom-select-options::-webkit-scrollbar-thumb {
              background-color: rgba(0, 0, 0, 0.2) !important;
              border-radius: 10px !important;
          }
          .custom-select-promo h2,
          .custom-select-promo .promo-title,
          .custom-select-title,
          .custom-select-wizard-view h2 {
              font-family: var(--font-heading, 'Quadrant', 'Quadrant Notepad', Georgia, serif) !important;
              font-weight: 400 !important;
              letter-spacing: -0.015em;
          }
      `;
    document.head.appendChild(style);
  }

  document.body.appendChild(backdrop);
  backdrop.appendChild(modal);

  let startY = 0;
  let currentY = 0;
  modal.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
  }, { passive: true });

  modal.addEventListener('touchmove', (e) => {
    const optionsContainer = e.target.closest('.custom-select-options');
    if (optionsContainer && optionsContainer.scrollTop > 0) {
      return;
    }

    currentY = e.touches[0].clientY;
    const diff = currentY - startY;
    if (diff > 0 && isMobile()) {
      modal.style.transform = `translateY(${diff}px)`;
    }
  }, { passive: true });

  modal.addEventListener('touchend', () => {
    if (!isMobile()) return;
    const diff = currentY - startY;
    if (diff > 80) {
      closeModal();
    } else {
      modal.style.transform = '';
    }
    startY = 0;
    currentY = 0;
  });
}

function renderWizardStep(stepIndex, animationClass) {
  try {
    const selectId = SELECT_ORDER[stepIndex];
    const select = document.getElementById(selectId);
    if (!select) return null;

    const view = document.createElement('div');
    view.className = `custom-select-wizard-view ${animationClass}`;

    const topRow = document.createElement('div');
    topRow.className = 'custom-select-top-row';
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'center';
    topRow.style.gap = '15px';
    topRow.style.width = '100%';
    topRow.style.marginTop = '15px';
    topRow.style.marginBottom = '25px';
    topRow.style.flexShrink = '0';

    const searchBox = document.createElement('button');
    searchBox.className = 'custom-select-search-box';
    searchBox.style.margin = '0';
    searchBox.style.flex = '1';
    searchBox.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:8px;opacity:0.5;"><path d="M17 17L21 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="M19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19C15.4183 19 19 15.4183 19 11Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg> <span style="opacity: 0.5;">Finder / AI Mode</span>';
    searchBox.addEventListener('click', () => {
      closeModal();
      const actualSearchInput = document.getElementById('searchTrigger');
      if (actualSearchInput) {
        actualSearchInput.focus();
        actualSearchInput.click();
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'custom-select-close-icon';
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" style="display:inline-block;vertical-align:middle;"><path d="M19.0005 4.99988L5.00049 18.9999M5.00049 4.99988L19.0005 18.9999" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>';
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.fontSize = '20px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '5px';
    closeBtn.addEventListener('click', () => {
      closeModal();
    });

    topRow.appendChild(searchBox);
    topRow.appendChild(closeBtn);

    const titleHtml = `<h2 class="font-quadrant custom-select-title" style="margin-top: 0; margin-bottom: 5px; font-family: var(--font-heading, 'Quadrant', 'Quadrant Notepad', Georgia, serif) !important;"><span class="promo-title font-quadrant" style="font-family: var(--font-heading, 'Quadrant', 'Quadrant Notepad', Georgia, serif) !important;">${SELECT_LABELS[selectId]}</span></h2>`;

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-select-options';
    optionsContainer.style.overflowY = 'auto';
    optionsContainer.style.flex = '1';
    optionsContainer.style.display = 'flex';
    optionsContainer.style.flexDirection = 'column';
    optionsContainer.style.gap = '8px';
    optionsContainer.style.paddingBottom = '10px';

    const selectOptions = Array.from(select.options);

    selectOptions.forEach((option) => {
      const item = document.createElement('button');
      item.className = 'site-button promo-secondary-btn custom-select-option';
      item.style.width = '100%';
      item.style.textAlign = 'left';
      item.style.justifyContent = 'flex-start';
      item.style.padding = '12px 20px';

      if (option.value === select.value) {
        item.classList.add('selected');
      }

      if (!option.value) {
        item.style.opacity = '0.8';
      }

      const displayText = option.value ? option.textContent : "All / Clear Filter";
      item.innerHTML = `<span style="flex: 1;">${displayText}</span>`;

      item.addEventListener('click', () => {
        select.selectedIndex = option.index;
        select.value = option.value;

        const container = modal.querySelector('.custom-select-wizard-container');
        const oldView = container?.querySelector('.custom-select-wizard-view:not([class*="slide-out"])');
        if (oldView) {
          const buttons = oldView.querySelectorAll('.custom-select-option');
          buttons.forEach(btn => btn.classList.remove('selected'));
          item.classList.add('selected');

          const actionBtn = oldView.querySelector('.custom-select-footer .promo-primary-btn');
          if (actionBtn && stepIndex < SELECT_ORDER.length - 1) {
            actionBtn.innerHTML = select.value ? 'Continue <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" style="display:inline-block;vertical-align:middle;margin-left:5px"><path d="M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>' : 'Apply & Close';
          }
        }

        try {
          select.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) {
          console.warn("Error dispatching change event on option click:", e);
        }

        if (select.value && stepIndex < SELECT_ORDER.length - 1) {
          setTimeout(() => {
            const nextSelect = document.getElementById(SELECT_ORDER[stepIndex + 1]);
            if (nextSelect && !nextSelect.disabled) {
              goToStep(stepIndex + 1, true);
            } else {
              setTimeout(() => {
                const retrySelect = document.getElementById(SELECT_ORDER[stepIndex + 1]);
                if (retrySelect && !retrySelect.disabled) {
                  goToStep(stepIndex + 1, true);
                }
              }, 100);
            }
          }, 250);
        }
      });

      optionsContainer.appendChild(item);
    });

    const footer = document.createElement('div');
    footer.className = 'custom-select-footer';
    footer.style.flexWrap = 'nowrap';
    const btnRadius = '20px';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'site-button promo-secondary-btn';
    prevBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" style="display:inline-block;vertical-align:middle"><path d="M15 6C15 6 9.00001 10.4189 9 12C8.99999 13.5812 15 18 15 18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>';
    prevBtn.style.padding = '12px 15px';
    prevBtn.style.flex = '0 0 auto';
    prevBtn.style.width = 'auto';
    prevBtn.style.borderRadius = btnRadius;
    if (stepIndex === 0) {
      prevBtn.style.opacity = '0.5';
      prevBtn.style.pointerEvents = 'none';
    } else {
      prevBtn.addEventListener('click', () => goToStep(stepIndex - 1, false));
    }

    const actionBtn = document.createElement('button');
    if (stepIndex === SELECT_ORDER.length - 1) {
      actionBtn.className = 'site-button promo-primary-btn';
      actionBtn.innerHTML = 'Start Reading <kbd style="margin-left: 6px; padding: 2px 7px; font-size: 11px; border-radius: 6px; background: rgba(255,255,255,0.22); border: 1px solid rgba(255,255,255,0.35); font-family: system-ui, sans-serif; display: inline-flex; align-items: center; line-height: 1;">↵</kbd>';
      actionBtn.style.flex = '1';
      actionBtn.style.background = 'var(--color-primary, #ff5400)';
      actionBtn.style.color = '#fff';
      actionBtn.style.border = 'none';
      actionBtn.style.padding = '12px 20px';
      actionBtn.style.fontWeight = 'bold';
      actionBtn.style.fontFamily = 'inherit';
      actionBtn.style.whiteSpace = 'nowrap';
      actionBtn.style.cursor = 'pointer';
      actionBtn.style.borderRadius = btnRadius;
      actionBtn.addEventListener('click', () => {
        closeModal();
        const submitBtn = document.getElementById('submitButton');
        if (submitBtn) submitBtn.click();
      });
    } else {
      actionBtn.className = 'site-button promo-primary-btn';
      actionBtn.innerHTML = select.value ? 'Continue <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" style="display:inline-block;vertical-align:middle;margin-left:5px"><path d="M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>' : 'Apply & Close';
      actionBtn.style.flex = '1';
      actionBtn.style.background = 'var(--color-primary, #ff5400)';
      actionBtn.style.color = '#fff';
      actionBtn.style.border = 'none';
      actionBtn.style.padding = '12px 20px';
      actionBtn.style.fontWeight = 'bold';
      actionBtn.style.fontFamily = 'inherit';
      actionBtn.style.whiteSpace = 'nowrap';
      actionBtn.style.cursor = 'pointer';
      actionBtn.style.borderRadius = btnRadius;

      actionBtn.addEventListener('click', () => {
        if (!select.value) {
          closeModal();
          const submitBtn = document.getElementById('submitButton');
          if (submitBtn) submitBtn.click();
        } else {
          goToStep(stepIndex + 1, true);
        }
      });
    }

    footer.appendChild(prevBtn);
    footer.appendChild(actionBtn);

    view.appendChild(topRow);
    view.insertAdjacentHTML('beforeend', titleHtml);
    view.appendChild(optionsContainer);
    view.appendChild(footer);

    if (!isMobile()) {
      const kbHint = document.createElement('div');
      kbHint.className = 'custom-select-keyboard-hint';
      kbHint.style.textAlign = 'center';
      kbHint.style.fontSize = '10px';
      kbHint.style.opacity = '0.5';
      kbHint.style.paddingTop = '10px';
      kbHint.style.marginTop = '4px';
      kbHint.style.flexShrink = '0';
      kbHint.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;margin-bottom:2px;"><path d="M14.5 7H9.5C6.21252 7 4.56878 7 3.46243 7.90796C3.25989 8.07418 3.07418 8.25989 2.90796 8.46243C2 9.56878 2 11.2125 2 14.5C2 17.7875 2 19.4312 2.90796 20.5376C3.07418 20.7401 3.25989 20.9258 3.46243 21.092C4.56878 22 6.21252 22 9.5 22H14.5C17.7875 22 19.4312 22 20.5376 21.092C20.7401 20.9258 20.9258 20.7401 21.092 20.5376C22 19.4312 22 17.7875 22 14.5C22 11.2125 22 9.56878 21.092 8.46243C20.9258 8.25989 20.7401 8.07418 20.5376 7.90796C19.4312 7 17.7875 7 14.5 7Z" stroke="currentColor" stroke-linecap="round"/><path d="M12 7V5C12 4.44772 12.4477 4 13 4C13.5523 4 14 3.55228 14 3V2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 12L8 12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.5 12L12.5 12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 12L17 12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 17L17 17" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg> Use&#8201;<kbd style="padding: 1px 4px; border-radius: 3px; border: 1px solid currentColor;">←</kbd> <kbd style="padding: 1px 4px; border-radius: 3px; border: 1px solid currentColor;">→</kbd> <kbd style="padding: 1px 4px; border-radius: 3px; border: 1px solid currentColor;">↑</kbd> <kbd style="padding: 1px 4px; border-radius: 3px; border: 1px solid currentColor;">↓</kbd> & <kbd style="padding: 1px 4px; border-radius: 3px; border: 1px solid currentColor;">Enter</kbd> to navigate';
      view.appendChild(kbHint);
    }

    return view;
  } catch (err) {
    console.error("renderWizardStep Error:", err);
    return null;
  }
}

export function goToStep(newIndex, forward = true) {
  if (!modal) return;
  const container = modal.querySelector('.custom-select-wizard-container');
  if (!container) return;

  const stuckViews = container.querySelectorAll('.custom-select-wizard-view[class*="slide-out"]');
  stuckViews.forEach(v => v.remove());

  const oldView = container.querySelector('.custom-select-wizard-view:not([class*="slide-out"])');
  const startHeight = container.getBoundingClientRect().height;
  if (startHeight > 0) {
    container.style.height = `${startHeight}px`;
  }

  currentStepIndex = newIndex;
  const newView = renderWizardStep(newIndex, forward ? 'wizard-slide-in-right' : 'wizard-slide-in-left');
  if (!newView) return;

  if (oldView) {
    oldView.style.position = 'absolute';
    oldView.style.top = '0';
    oldView.style.left = '0';
    oldView.style.right = '0';
    oldView.style.width = '100%';
    oldView.style.zIndex = '0';
    oldView.style.pointerEvents = 'none';
    oldView.classList.add(forward ? 'wizard-slide-out-left' : 'wizard-slide-out-right');
    setTimeout(() => {
      if (oldView && oldView.parentNode) {
        oldView.remove();
      }
    }, 280);
  }

  container.appendChild(newView);

  requestAnimationFrame(() => {
    const targetHeight = newView.getBoundingClientRect().height;
    if (targetHeight > 0) {
      container.style.height = `${targetHeight}px`;
    }

    setTimeout(() => {
      if (container) container.style.height = '';
    }, 300);

    const selected = newView.querySelector('.selected');
    if (selected) {
      const optionsContainer = newView.querySelector('.custom-select-options');
      if (optionsContainer) {
        optionsContainer.scrollTop = selected.offsetTop - optionsContainer.offsetTop - 20;
      }
    }
  });
}

export function openModal(selectId) {
  try {
    if (closeTimeout) {
      clearTimeout(closeTimeout);
      closeTimeout = null;
    }

    const select = document.getElementById(selectId);
    if (!select || select.disabled) return;

    createModal();

    const targetIndex = SELECT_ORDER.indexOf(selectId);
    currentStepIndex = targetIndex !== -1 ? targetIndex : 0;

    const container = modal.querySelector('.custom-select-wizard-container');
    if (container) container.innerHTML = '';

    const newView = renderWizardStep(currentStepIndex, '');
    if (newView && container) {
      container.appendChild(newView);
    }

    if (backdrop) {
      backdrop.style.display = 'flex';
      void backdrop.offsetWidth;
      backdrop.style.opacity = '1';
      backdrop.dataset.openedTime = Date.now();
    }
    if (modal) modal.style.transform = '';
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      const selected = newView?.querySelector('.selected');
      if (selected) {
        const optionsContainer = newView.querySelector('.custom-select-options');
        if (optionsContainer) {
          optionsContainer.scrollTop = selected.offsetTop - optionsContainer.offsetTop - 20;
        }
      }
    });
  } catch (err) {
    console.error("openModal Error:", err);
  }
}

export function closeModal() {
  if (!backdrop) return;
  backdrop.style.opacity = '0';
  if (closeTimeout) clearTimeout(closeTimeout);
  closeTimeout = setTimeout(() => {
    backdrop.style.display = 'none';
    document.body.style.overflow = '';
    if (modal) {
      const container = modal.querySelector('.custom-select-wizard-container');
      if (container) container.innerHTML = '';
    }
  }, 400);
}

function setupSelects() {
  if (typeof document === 'undefined') return;
  SELECT_ORDER.forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      select.style.pointerEvents = 'auto';
      select.setAttribute('tabindex', '-1');

      if (!select._customIntercepted) {
        select._customIntercepted = true;

        const blockAndOpen = (e) => {
          e.preventDefault();
          e.stopPropagation();
          select.blur();

          const now = Date.now();
          if (now - lastTriggeredTime > 200 && !select.disabled) {
            lastTriggeredTime = now;
            openModal(id);
          }
        };

        select.addEventListener('touchstart', blockAndOpen, { passive: false, capture: true });
        select.addEventListener('mousedown', blockAndOpen, { capture: true });
        select.addEventListener('click', blockAndOpen, { capture: true });

        const wrapper = select.parentElement;
        if (wrapper && !wrapper._customWrapperBound) {
          wrapper._customWrapperBound = true;
          wrapper.addEventListener('click', (e) => {
            if (e.target !== select) {
              blockAndOpen(e);
            }
          });
        }
      }
    }
  });
}

export function init() {
  if (typeof document === 'undefined') return;
  setupSelects();
  
  if (!isInitialized) {
    isInitialized = true;
    
    document.addEventListener('keydown', (e) => {
      if (!backdrop || backdrop.style.display === 'none' || backdrop.style.opacity === '0') return;

      if (e.key === 'Escape') {
        closeModal();
        return;
      }

      const container = modal.querySelector('.custom-select-wizard-container');
      const activeView = container?.querySelector('.custom-select-wizard-view:not([class*="slide-out"])');
      if (!activeView) return;

      const options = Array.from(activeView.querySelectorAll('.custom-select-option'));
      if (!options.length) return;

      let currentIndex = options.findIndex(opt => opt.classList.contains('selected'));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        let nextIndex = currentIndex + 1;
        if (nextIndex >= options.length) nextIndex = 0;
        options.forEach(opt => opt.classList.remove('selected'));
        options[nextIndex].classList.add('selected');
        const optionsContainer = activeView.querySelector('.custom-select-options');
        if (optionsContainer) {
          optionsContainer.scrollTop = options[nextIndex].offsetTop - optionsContainer.offsetTop - 20;
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        let prevIndex = currentIndex - 1;
        if (prevIndex < 0) prevIndex = options.length - 1;
        options.forEach(opt => opt.classList.remove('selected'));
        options[prevIndex].classList.add('selected');
        const optionsContainer = activeView.querySelector('.custom-select-options');
        if (optionsContainer) {
          optionsContainer.scrollTop = options[prevIndex].offsetTop - optionsContainer.offsetTop - 20;
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentStepIndex > 0) {
          goToStep(currentStepIndex - 1, false);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const selectId = SELECT_ORDER[currentStepIndex];
        const select = document.getElementById(selectId);
        if (select && select.value && currentStepIndex < SELECT_ORDER.length - 1) {
          goToStep(currentStepIndex + 1, true);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (currentIndex !== -1) {
          options[currentIndex].click();
        }

        const actionBtn = activeView.querySelector('.custom-select-footer .promo-primary-btn');
        if (actionBtn && !actionBtn.style.pointerEvents) {
          const isLastStep = actionBtn.textContent.includes('Start Reading');
          if (isLastStep || currentIndex === -1) {
            actionBtn.click();
          }
        }
      }
    });

    // Observe DOM changes instead of continuous 1s setInterval polling
    let selectDebounce = null;
    const observer = new MutationObserver(() => {
      if (selectDebounce) clearTimeout(selectDebounce);
      selectDebounce = setTimeout(setupSelects, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
