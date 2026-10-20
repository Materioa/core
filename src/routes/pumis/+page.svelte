<script>
  import ContentPage from '$lib/components/ContentPage.svelte';
</script>

<svelte:head>
  <meta name="keywords" content="PUMIS, PUMIS Login, PUMIS Student Portal, student.pumis.in, Parul University PUMIS, PUMIS Portal, PU Attendance, PU Hostel PUMIS, PU Elearning, Materio PU" />
  
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": "https://getmaterio.app/pumis#webpage",
        "url": "https://getmaterio.app/pumis",
        "name": "PUMIS Student Portal & Login Guide — Parul University | Materio",
        "description": "Direct links and complete guide for Parul University PUMIS student portal (student.pumis.in), attendance, exam papers, and study resources on Materio.",
        "isPartOf": {
          "@type": "WebSite",
          "@id": "https://getmaterio.app/#website",
          "name": "Materio",
          "url": "https://getmaterio.app/"
        }
      },
      {
        "@type": "FAQPage",
        "@id": "https://getmaterio.app/pumis#faq",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How to log into PUMIS Student Portal?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Visit student.pumis.in and sign in using your Parul University Enrollment Number or registered email address and your password or OTP."
            }
          },
          {
            "@type": "Question",
            "name": "Where can I get study materials without logging into PUMIS?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "You can access all semester notes, computer science subjects, and question banks directly on Materio (getmaterio.app) without needing PUMIS credentials."
            }
          }
        ]
      }
    ]
  }
  </script>
</svelte:head>

<ContentPage
  title="PUMIS Portal Login & Student Guide — Parul University"
  description="Direct access to Parul University PUMIS student portal login, attendance updates, and fast curated study resources on Materio."
  canonicalPath="/pumis"
>
  <h1>PUMIS Student Portal &amp; Login Guide — Parul University</h1>

  <blockquote>
    <p>Direct login guidance for <strong>PUMIS (Parul University Management Information System)</strong>, plus fast access to university study materials on <strong>Materio</strong>.</p>
  </blockquote>

  <p>
    <strong>PUMIS</strong> is Parul University's primary student information system. It manages official academic profiles, internal attendance records, exam timetables, fee payments, and hostel requests.
  </p>

  <div style="background: rgba(255, 132, 0, 0.08); border-left: 4px solid #ff8400; padding: 14px 18px; margin: 1.5rem 0; border-radius: 4px;">
    <strong>Looking for study notes, PPTs, or PYQs?</strong> You don't need to log into PUMIS or PU Elearning to study. <a href="/" style="font-weight: 600; text-decoration: underline;">Open Materio App</a> to start reading verified semester materials immediately.
  </div>

  <h2>Official PUMIS Links</h2>
  <ul>
    <li><strong>Student Login Portal:</strong> <a href="https://student.pumis.in" target="_blank" rel="noopener noreferrer">student.pumis.in</a></li>
    <li><strong>Hostel Management:</strong> <a href="https://hostel.pumis.in" target="_blank" rel="noopener noreferrer">hostel.pumis.in</a></li>
    <li><strong>PU E-Learning LMS:</strong> <a href="https://elearning.paruluniversity.ac.in" target="_blank" rel="noopener noreferrer">elearning.paruluniversity.ac.in</a></li>
    <li><strong>PU Student App:</strong> <a href="https://play.google.com/store/apps/details?id=com.pupumis.student" target="_blank" rel="noopener noreferrer">Download on Google Play</a></li>
  </ul>

  <h2>How to Log In to PUMIS</h2>
  <ol>
    <li>Navigate to <a href="https://student.pumis.in" target="_blank" rel="noopener noreferrer">student.pumis.in</a>.</li>
    <li>Enter your <strong>Enrollment Number</strong> or university-registered email.</li>
    <li>Input your account password or request an OTP if enabled.</li>
    <li>View your dashboard for real-time attendance, timetables, and exam hall tickets.</li>
  </ol>

  <h2>PUMIS vs. Materio</h2>
  <table style="width: 100%; border-collapse: collapse; margin-top: 1rem;">
    <thead>
      <tr style="border-bottom: 2px solid #ddd; text-align: left;">
        <th style="padding: 8px;">Feature</th>
        <th style="padding: 8px;">Official PUMIS</th>
        <th style="padding: 8px;">Materio</th>
      </tr>
    </thead>
    <tbody>
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px;"><strong>Attendance &amp; Fees</strong></td>
        <td style="padding: 8px;">Yes (Official)</td>
        <td style="padding: 8px;">No</td>
      </tr>
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px;"><strong>Curated Study Notes &amp; PPTs</strong></td>
        <td style="padding: 8px;">Scattered / Slow</td>
        <td style="padding: 8px;"><strong>Yes (Instant, Sem 1–8)</strong></td>
      </tr>
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px;"><strong>Offline Reading (PWA)</strong></td>
        <td style="padding: 8px;">No</td>
        <td style="padding: 8px;"><strong>Yes</strong></td>
      </tr>
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px;"><strong>Login Required to Read</strong></td>
        <td style="padding: 8px;">Yes</td>
        <td style="padding: 8px;"><strong>No (One-click start)</strong></td>
      </tr>
    </tbody>
  </table>

  <hr style="margin: 2rem 0; opacity: 0.2;" />
  <p style="text-align: center;">
    <a href="/" style="display: inline-block; background: #ff8400; color: white; padding: 10px 22px; border-radius: 8px; font-weight: 600; text-decoration: none;">Explore Notes on Materio</a>
    &nbsp;&nbsp;
    <a href="/pu-elearning" style="display: inline-block; padding: 10px 18px; border: 1px solid #ff8400; border-radius: 8px; color: #ff8400; font-weight: 600; text-decoration: none;">View PU Elearning Guide</a>
  </p>
</ContentPage>
