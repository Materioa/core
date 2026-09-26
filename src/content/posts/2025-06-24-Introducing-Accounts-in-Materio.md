---
title: Introducing Account in Materio and more...
layout: post
date: '2025-06-24 18:30:00'
category: whats-new
excerpt: Materio v4.5.6.0 brings many changes to underlying system including UI changes
  and feature additions opening ways from being just a reading material library.
image: /assets/img/covers/cover.webp
summarize: true
---

Materio v4.5.6.0 brings a ton of changes while it might not look like much's happening on the top at User side but the entire codebase has been restructured from scratch with performance enhancements, better user experiences, minor to mild UI changes and some new features additions.

Starting from homepage a slight change has been implimented by adding moving Noise texture (indicating a everygrowing fields and topics) and a shimmer effect on the button emphasising the main action also the the button text has been changed from 'Submit' to 'Start Reading' now as a part of better UX changes.
![homepage](/assets/img/post-content/9755de83-e854-43d5-bac4-53f443d79ebc-home.png)

Also, the reader performance has been increased by integrating the pdf.js natively in materio which has been finetuned, this custom varient of pdf.js is named oread (openreader).

The next visual change has been done in settings page
The settings page has been reworked and divided into two tabs, 
1. Prefrences 
2. About this app
![settings](/assets/img/post-content/66f86286-6aa5-432c-ae7e-fe1ecd7d7740-settings.jpeg)
this change reduces clutter and seprates acessibility related settings from system information and other things.

All the customisation settings like theme, reading modes (new), background and cookie settings are moved to default tab (prefrences) for easier navigation. and Changelog, legal links are moved to about this app tab.

Now, the new 4.5.6.0 introduces three new reading filters 
1. Paper mode
2. Night mode 
3. E-Ink mode
![reading modes](/assets/img/post-content/6d51f393-3097-46e6-a8ef-fa701e3a2210-modes.png)

Paper mode applies a texture overlay enabling a natural look, the texture grain size can be adjusted through the given slider.
![paper mode](/assets/img/post-content/d91e925d-0f6d-4eb3-a86b-287ed78c6f0a-paper.png)

Night mode reduces the eye strain when reading late night, you can adjust warmth via the slider and can also auto schedule so that the filter will take effect on its own when the start time reaches and turns off when its set duration ends.
![night mode](/assets/img/post-content/84b68e22-350d-494f-a489-2bb66ef2ac9a-night.png)

E-Ink mode is a grayscale filter to imitate kindle like reading experience, when combined with paper mode it gives best results.

Apart from these filters there is a improved way to navigate between the pages of website for mobile users, Swipe.
Users can now just swipe horizontally to navigate or switch to pages like Home, Chat, Notifications and Settings and it transitions to desired page with a haptic feedback.

To better experience these changes and features  v4.5.6.0 also brings new PWA (Progressive Web App) v1.0 now available across all platforms.
You will be prompted to install the WebApp when opened v4.5.6.0 with options to install or remind later.
![install webapp](/assets/img/post-content/7ce99727-ac10-4aec-89a6-e2b4d61980ec-pwa-modal.png)

These are pretty much all the changes to the main ui but there's One more thing... the annoying 'File not found' or err:404 has a fix.

Community Contributions!
whenever you encounter the 'File not found' error, Materio will now show a button asking you to contribute the missing resource if you do find to have it. This way it will help the community find the actual resources needed.
![contributions](/assets/img/post-content/b6ea54d7-0e95-4ca0-a953-85cedf38fef6-contribute.png)

Now, this version brings Account which is used to get beta acess to new features and other things that might come in future like Google drive integration to acess all personal files, take quick notes and upload lab files to your drive from materio itself.
![dashboard](/assets/img/post-content/751012df-91f8-4f04-8a1c-5ed52a70ff08-dashboard.png)

The account creation is currently limited to only those who are invited by entering the invite code
after invite code is validated you may continue the onboarding process to create the account.
![invite](/assets/img/post-content/68b4a8b2-0171-4457-adbd-226c7c1a7bea-invited.png)
![onboarding](/assets/img/post-content/c0b21caa-4d04-41b9-b3b0-7e863b418261-onboard.png)

Special Clause: Materio is Vibe Coded and built with agentic help of Claude.


## Updates to the Insightroom 

- Homepage redesign
 - changes made to color scheme
 - Sorting according to categories via category tags
 - Quick reads section: all posts with no images are here.
 - Search: quickly find what you're looking for.

- Post redesign
 - Date & Category show up in a modern pill shape
 - introduced linked posts
   usage:
   Add the following tags in the markdown frontmatter

    ```MD
    ---
    previous_post: "/path-to-previous-post"
    next_post: "/path-to-next-post"
    ---
    ```
 - Introducing AI Summary for the Super users, powered by gpt-oss (20b) model by OpenAI.
   Usage:

   Enable the AI summary in the any post by adding the tag in the md frontmatter

   ```MD
   ---
   summarize: true
   ---
   ```

   - you can summarize the post content in consise form factor and typically 1/6th of the original content.
   - Didn't find what you wanted in the summary? Ask a follow up - ask your question and it will explain your query.


 - Introducing File attachments
   Now the posts like those for general announcements or special posts can contain attachments of anyfile type Image/Documents.
   To attach:

   - enable attachment in the md frontmatter and declare the attachment content like this.
   ```MD
   ---
   attachment: true
   ---

   [attachment:/path-to-your-attachment:Name of your attachment]
   ```

