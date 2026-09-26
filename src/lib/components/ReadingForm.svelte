<script>
  import { onMount, tick } from 'svelte';
  import HugeIcon from "./HugeIcon.svelte";
  import { pdfModalStore, activeModalStore, openPdfModal } from '$lib/stores.js';
  import QuickSearch from './QuickSearch.svelte';

  let rawLibData = null;
  let semesters = [];
  let subjects = [];
  let categories = [];
  let topics = [];

  let selectedSemester = '7';
  let selectedSubject = '';
  let selectedCategory = '';
  let selectedTopic = '';

  const semesterMapping = { 9: 'Additional Resources', 9999: 'Vault' };

  onMount(async () => {
    try {
      const cdnUrl = 'https://cdn.getmaterio.app/databases/beta/resource.lib.json';
      let res = await fetch(cdnUrl).catch(() => null);
      
      if (!res || !res.ok) {
          res = await fetch('/assets/data/resource.lib.json').catch(() => null);
      }
      
      if (res && res.ok) {
        rawLibData = await res.json();
        await loadSemesters();
        await tick();
      } else {
        console.error('Failed to load resource library data from both CDN and local fallback.');
      }
    } catch (e) {
      console.error('Failed to load resource library data:', e);
    }

    const customSelectModule = await import('$lib/utils/custom-select.js').catch(() => null);
    if (customSelectModule && typeof customSelectModule.init === 'function') {
      customSelectModule.init();
    }
  });

  async function loadSemesters() {
    if (!rawLibData) return;
    const keys = Object.keys(rawLibData).filter(k => k !== '9999');
    semesters = keys.map(k => ({
      val: k,
      label: semesterMapping[k] || `Semester ${k}`
    }));

    if (rawLibData['7']) {
      selectedSemester = '7';
      await handleSemesterChange();
    } else if (semesters.length > 0) {
      selectedSemester = semesters[0].val;
      await handleSemesterChange();
    }
  }

  async function handleSemesterChange(event) {
    if (event?.target?.value !== undefined) {
      selectedSemester = event.target.value;
    }
    selectedSubject = '';
    selectedCategory = '';
    selectedTopic = '';
    categories = [];
    topics = [];

    if (!rawLibData || !selectedSemester) {
      subjects = [];
      return;
    }

    const semData = rawLibData[selectedSemester];
    if (!semData) {
      subjects = [];
      return;
    }

    subjects = Object.keys(semData);
    await tick();
  }

  async function handleSubjectChange(event) {
    if (event?.target?.value !== undefined) {
      selectedSubject = event.target.value;
    }
    selectedCategory = '';
    selectedTopic = '';
    topics = [];

    if (!rawLibData || !selectedSemester || !selectedSubject) {
      categories = [];
      return;
    }

    const catArr = rawLibData[selectedSemester]?.[selectedSubject];
    if (Array.isArray(catArr)) {
      categories = catArr.map((c, idx) => ({
        idx: idx.toString(),
        label: c.type || `Category ${idx + 1}`,
        rawObj: c
      }));

      const defaultIdx = categories.findIndex(c => c.label.trim().toLowerCase() === 'chapters');
      if (defaultIdx !== -1) {
        selectedCategory = categories[defaultIdx].idx;
      } else if (categories.length > 0) {
        selectedCategory = categories[0].idx;
      }

      await handleCategoryChange();
    } else {
      categories = [];
    }
    await tick();
  }

  async function handleCategoryChange(event) {
    if (event?.target?.value !== undefined) {
      selectedCategory = event.target.value;
    }
    selectedTopic = '';

    if (!rawLibData || !selectedSemester || !selectedSubject || selectedCategory === '') {
      topics = [];
      return;
    }

    const catArr = rawLibData[selectedSemester]?.[selectedSubject];
    const catObj = catArr?.[parseInt(selectedCategory)];
    if (catObj && Array.isArray(catObj.content)) {
      topics = catObj.content.map(t => {
        if (typeof t === 'string') return { name: t, url: null };
        return { name: t.name || t.title || 'Untitled Topic', url: t.url || null };
      });
      // Default to first topic (parent main.js: topicSelect.selectedIndex = 1)
      if (topics.length > 0) {
        selectedTopic = topics[0].name;
      }
    } else {
      topics = [];
    }
    await tick();
  }

  function handleSubmit() {
    if (!selectedSemester || !selectedSubject || selectedCategory === '' || !selectedTopic) {
        const roasts = [
            { message: "Start Reading what? The entire syllabus in one night? Pick a topic before the speedrun glitch-abuses you.", button: "Fair..." },
            { message: "Bro hit Start Reading like he’s about to unlock 16 weeks of content in 16 seconds. Select something before the game crashes.", button: "Valid" },
            { message: "Calm down, scholar. You can’t speedrun the whole syllabus by mashing Start Reading. Choose a chapter before attempting the world record.", button: "Alright, alright" },
            { message: "Trying to Start Reading without picking anything? That’s peak “exam is tomorrow so let me learn the entire degree tonight” energy. Select something.", button: "True" },
            { message: "You pressed Start Reading like Netflix’s “Skip Intro” works on coursework. It doesn’t. Pick a topic.", button: "Touché" },
            { message: "Start Reading with no selection? Bro’s on that “I’ll finish the syllabus tonight, trust me” delusion. Choose something real.", button: "My bad" },
            { message: "You tried to read nothing. Classic exam-eve panic maneuver. Grab a topic before the syllabus grabs YOU.", button: "Okay fine" },
            { message: "This isn’t a Marvel recap. You can’t skip 5 months and Start Reading. Make a selection first, prodigy.", button: "Fair point" },
            { message: "Pressing Start Reading with zero choices… bold. That’s some last-minute all-nighter confidence right there. Select something.", button: "I’ll behave" },
            { message: "Trying to absorb knowledge telepathically now? Pick what you want to read before going full Doctor Strange on the syllabus.", button: "Say less" },
        ];
        const randomRoast = roasts[Math.floor(Math.random() * roasts.length)];
        if (typeof window !== 'undefined' && window.materioAlert) window.materioAlert(randomRoast.message, { title: "Selection Required", type: "warning", buttonText: randomRoast.button });
        else alert(randomRoast.message);
        return;
    }

    const topicItem = topics.find(t => t.name === selectedTopic);
    const catObj = rawLibData[selectedSemester]?.[selectedSubject]?.[parseInt(selectedCategory)];
    const catName = catObj?.type || 'General';

    const pdfUrl = topicItem?.url || (selectedSemester === "9999"
      ? `https://cdn.getmaterio.app/pdfs/${selectedSemester}/${encodeURIComponent(selectedSubject)}/vault/${encodeURIComponent(selectedTopic)}.pdf`
      : `https://cdn.getmaterio.app/pdfs/${selectedSemester}/${encodeURIComponent(selectedSubject)}/${encodeURIComponent(selectedTopic)}.pdf`);

    openPdfModal(pdfUrl, {
      title: selectedTopic,
      semester: `Semester ${selectedSemester}`,
      subject: selectedSubject,
      category: catName,
      topic: selectedTopic,
      readingMode: 'default'
    });
  }

  function openContributeModal() {
    activeModalStore.set('contribute');
  }
</script>

<div class="card-one" id="reading">
  <h2>What are you reading today?</h2>
  <form id="readingSelectionForm" on:submit|preventDefault={handleSubmit}>
    <div>
      <label for="semesterSelect"></label>
      <select id="semesterSelect" aria-label="Select Semester" bind:value={selectedSemester} on:change={handleSemesterChange}>
        <option value="">Select Semester</option>
        {#each semesters as sem}
          <option value={sem.val}>{sem.label}</option>
        {/each}
      </select>
    </div>
    <div>
      <label for="subjectSelect"></label>
      <select id="subjectSelect" aria-label="Select Subject" disabled={!selectedSemester || subjects.length === 0} bind:value={selectedSubject} on:change={handleSubjectChange}>
        <option value="">Select Subject</option>
        {#each subjects as sub}
          <option value={sub}>{sub}</option>
        {/each}
      </select>
    </div>
    <div>
      <label for="categorySelect"></label>
      <select id="categorySelect" aria-label="Select Category" disabled={!selectedSubject || categories.length === 0} bind:value={selectedCategory} on:change={handleCategoryChange}>
        <option value="">Select Category</option>
        {#each categories as cat}
          <option value={cat.idx}>{cat.label}</option>
        {/each}
      </select>
    </div>
    <div>
      <label for="topicSelect"></label>
      <select id="topicSelect" aria-label="Select Topic" disabled={selectedCategory === '' || topics.length === 0} bind:value={selectedTopic} on:change={(e) => { selectedTopic = e.target.value; }}>
        <option value="">Select Topic</option>
        {#each topics as t}
          <option value={t.name}>{t.name}</option>
        {/each}
      </select>
    </div>
  </form>

  <div class="reading-controls-wrapper" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 20px; flex-wrap: wrap;">
    <QuickSearch />

    <div class="icon-buttons-container" style="display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-left: auto;">
      <button type="button" on:click={openContributeModal} class="icon-button"
        style="position: relative; display: inline-flex; align-items: center; justify-content: center; width: 45px; height: 45px; min-width: 45px; background: var(--color-primary-light); border: 1px solid var(--color-primary-border); border-radius: 25px; color: var(--color-primary); cursor: var(--f-cursor-pointer); transition: all 0.3s ease; backdrop-filter: blur(4px);">
        <HugeIcon name="plus-sign-circle" size="20" />
        <span class="tooltip-text"
          style="position: absolute; bottom: 120%; left: 50%; transform: translateX(-50%); background: rgba(0, 0, 0, 0.9); color: white; padding: 6px 12px; border-radius: 6px; font-size: 12px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.3s ease;">Contribute</span>
      </button>
    </div>

    <button id="submitButton" type="button" class="shimmer-button" on:click={handleSubmit}>
      <span class="shimmer-text"><b>Start Reading</b></span>
    </button>
  </div>
</div>
