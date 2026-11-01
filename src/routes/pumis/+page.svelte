<script>
  import ContentPage from '$lib/components/ContentPage.svelte';
</script>

<svelte:head>
  <title>Materio</title>
  <meta property="og:title" content="Materio" />
  <meta name="twitter:title" content="Materio" />
  <meta name="keywords" content="Materio, PUMIS, PUMIS Login, student.pumis.in, Parul University PUMIS, PU attendance, PU hostel, PU elearning" />
  
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": "https://getmaterio.app/pumis#webpage",
        "url": "https://getmaterio.app/pumis",
        "name": "Materio",
        "description": "Student portal guide, login navigation, and study resources on Materio.",
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
              "text": "Visit student.pumis.in and sign in using your Enrollment Number or registered email address and your password or OTP."
            }
          },
          {
            "@type": "Question",
            "name": "Where can I get study materials without logging into PUMIS?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "You can access semester notes, computer science subjects, and question banks directly on Materio (getmaterio.app)."
            }
          }
        ]
      }
    ]
  }
  </script>
</svelte:head>

<ContentPage
  title="Student Portal Companion"
  tabTitle="Materio"
  description="Student portal guide, login navigation, and fast curated study resources on Materio."
  canonicalPath="/pumis"
>
  <blockquote>
    <p>Student guide for <strong>PUMIS</strong> navigation, plus quick access to academic materials on <strong>Materio</strong>.</p>
  </blockquote>

  <p>
    <strong>PUMIS</strong> is Parul University's primary student information system, managing official academic profiles, attendance records, exam timetables, fee payments, and hostel requests.
  </p>

  <div style="background: rgba(255, 132, 0, 0.08); border-left: 4px solid #ff8400; padding: 14px 18px; margin: 1.5rem 0; border-radius: 4px;">
    <strong>Looking for study notes, PPTs, or PYQs?</strong> You don't need to log into administrative portals to read. <a href="/" style="font-weight: 600; text-decoration: underline;">Open Materio App</a> to start reading verified semester materials immediately.
  </div>

  <h2>Official Portal Links</h2>
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

  <h2>Portal Reference vs. Materio</h2>
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
        <td style="padding: 8px;">Scattered</td>
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
    <a href="/pu-elearning" style="display: inline-block; padding: 10px 18px; border: 1px solid #ff8400; border-radius: 8px; color: #ff8400; font-weight: 600; text-decoration: none;">View E-Learning Guide</a>
  </p>
</ContentPage>
