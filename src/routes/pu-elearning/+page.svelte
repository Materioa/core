<script>
  import ContentPage from '$lib/components/ContentPage.svelte';
</script>

<svelte:head>
  <title>Materio</title>
  <meta property="og:title" content="Materio" />
  <meta name="twitter:title" content="Materio" />
  <meta name="keywords" content="Materio, PU Elearning, Parul Elearning, PUMIS, Parul University, PU, student.pumis.in, elearning.paruluniversity.ac.in, PU study materials, CSE notes, PYQs, syllabus" />
  
  <!-- Structured Data: FAQPage for semantic search answering student queries -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": "https://getmaterio.app/pu-elearning#webpage",
        "url": "https://getmaterio.app/pu-elearning",
        "name": "Materio",
        "description": "Student guide and study resource companion for campus e-learning and portal navigation.",
        "isPartOf": {
          "@type": "WebSite",
          "@id": "https://getmaterio.app/#website",
          "name": "Materio",
          "url": "https://getmaterio.app/"
        }
      },
      {
        "@type": "FAQPage",
        "@id": "https://getmaterio.app/pu-elearning#faq",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "What is PU Elearning and how does Materio help?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "PU Elearning is Parul University's online learning management system. Materio is an independent, fast study hub that helps students organize, read, and bookmark lecture notes, PPTs, syllabus, and PYQs without server timeouts or login friction."
            }
          },
          {
            "@type": "Question",
            "name": "Where can I find PU CSE and engineering semester notes?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Materio provides verified semester-wise notes, chapter presentations, and question banks categorized from Semester 1 to 8."
            }
          },
          {
            "@type": "Question",
            "name": "How can I access study notes offline?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Using Materio as a PWA or Android app, you can bookmark materials to read them offline without an internet connection."
            }
          }
        ]
      }
    ]
  }
  </script>
</svelte:head>

<ContentPage
  title="E-Learning Companion"
  tabTitle="Materio"
  description="Independent student companion for e-learning, portal navigation, and organized lecture notes."
  canonicalPath="/pu-elearning"
>
  <blockquote>
    <p>Independent student resource guide for <strong>PU E-Learning</strong> and campus academic resources. Faster, simpler, and accessible anytime.</p>
  </blockquote>

  <p>
    Welcome to the student companion for <strong>Parul University (PU) E-Learning</strong> and <strong>PUMIS</strong>. If you are looking for lecture slides, semester notes, syllabus copies, or previous year question papers (PYQs), this guide links to both official portals and Materio's clean study reader.
  </p>

  <div style="background: rgba(255, 132, 0, 0.08); border-left: 4px solid #ff8400; padding: 14px 18px; margin: 1.5rem 0; border-radius: 4px;">
    <strong>⚡ Quick Start:</strong> <a href="/" style="font-weight: 600; text-decoration: underline;">Open Materio App</a> to immediately browse Semester 1 to 8 notes, computer science resources, and reading tools.
  </div>

  <h2>Official Campus Portals</h2>
  <p>For administrative duties like attendance tracking, exam hall tickets, or fee payments, use the official links below:</p>
  <ul>
    <li>
      <strong>PUMIS Student Portal:</strong> <a href="https://student.pumis.in" target="_blank" rel="noopener noreferrer">student.pumis.in</a> — Attendance records, timetables, and fee receipts.
    </li>
    <li>
      <strong>PU E-Learning Portal:</strong> <a href="https://elearning.paruluniversity.ac.in" target="_blank" rel="noopener noreferrer">elearning.paruluniversity.ac.in</a> — LMS assignments, tests, and faculty uploads.
    </li>
    <li>
      <strong>PU Online (Distance LMS):</strong> <a href="https://lms.paruluniversity.online" target="_blank" rel="noopener noreferrer">lms.paruluniversity.online</a> — Online degree learning dashboard.
    </li>
    <li>
      <strong>PU Student App:</strong> Mobile portal for attendance and notifications.
    </li>
  </ul>

  <h2>Why Use Materio for Daily Study?</h2>
  <p>Official LMS portals are essential for grades and attendance, but when preparing for exams, students often experience slow loading times or difficult navigation. Materio provides:</p>
  <ul>
    <li><strong>Instant Loading:</strong> Access curated study materials without waiting for portal sessions to reload.</li>
    <li><strong>Organized by Semester:</strong> Select your semester (Sem 1–8), subject, and unit to start reading immediately.</li>
    <li><strong>Comfortable Reader:</strong> Built-in Paper, Night, and E-ink modes for long study sessions.</li>
    <li><strong>Offline Access:</strong> Bookmark documents to read them offline in the Materio app.</li>
  </ul>

  <h2>FAQ</h2>
  <h3>What is the difference between PUMIS and E-Learning?</h3>
  <p><strong>PUMIS</strong> (student.pumis.in) handles administrative tasks like attendance, exams, and fees. <strong>PU E-Learning</strong> (elearning.paruluniversity.ac.in) hosts course modules and quizzes.</p>

  <h3>Does Materio replace university portals?</h3>
  <p>No. Materio is an independent study tool for reading notes and preparing for exams. For official attendance and submissions, always use the official portals.</p>

  <hr style="margin: 2rem 0; opacity: 0.2;" />
  <p style="text-align: center; margin-top: 1.5rem;">
    <a href="/" style="display: inline-block; background: #ff8400; color: white; padding: 10px 22px; border-radius: 8px; font-weight: 600; text-decoration: none;">Launch Materio Study App</a>
  </p>
</ContentPage>
