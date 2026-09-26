---
title: How to Download Materials from PULMS
date: '2025-05-10'
category: Howto
excerpt: Know how to download PDFs and other materials from PULMS (E-learning) website
image: /assets/img/covers/howto.webp
author: Jinansh - Materio
summarize: true
attachment: true
# visibility: private
---

We all know how frustrating it is not being able to download the study materials our faculties upload on the official elearning or pulms website right, especially when the pdf is big pr network quality is bad it may take quite sometime to load.

Well i have got some good news, I found a workaround to download the PDF from there.

> This method requires use of DevTools and only works on desktop!.

So, lets see how its done

---

### Step - 1:
Login to [PULMS](https://elearning.paruluniversity.ac.in)  

### Step - 2:
Navigate to classrooms section and open your classroom, You will find the subjects listed.

### Step - 3:
Open the desired subject and head over to ‘classwork’ section where all the materials will be listed  
![img1](/assets/img/post-content/76616a21-7325-4141-afed-bc7c4b8c11af.webp)

### Step - 4:
Now, this is where main trick starts. Open the DevTools and navigate to the Network tab.  
![img2](/assets/img/post-content/ddfef6dd-12fe-4818-ad58-a4a9bb6d9549.webp)

### Step - 5:
Open the PDF you want to read. Now as soon as you click on “Click to View” to open the PDF, you should see ton of network requests populating in the ‘Network’ tab.  
![img3](/assets/img/post-content/f4a0c397-bbe4-4c10-a0bc-c6abc602ea91.webp)

### Step - 6:
In the requests listed, you have to look for a specific `fetch` request with `status: 200`, this request doesnt have a fixed name as it keeps changing with the classroom id so you will have to struggle a bit to find the correct one, but it wont be hard if you followed steps 4 and 5 properly.

- To give it away the size of request will be 600+ KB or biggest of all other request size.

### Step - 7:
Now click on that fetch request and you will see its info. In that you will find the URL of PDF as `Request URL` in “Headers” tab, this URL will look something like  
`https://storage.googleapis.com/parul-local-tmp/221f7eba-f1fc-469c-95de-57060b4668ae-coa_ppts.pdf`  
(yeah Google firebase storage bucket URL).  
![img4](/assets/img/post-content/25474b1a-abbd-47fb-8d63-2b3c5edbdcd4.webp)

### Step - 8:
Now, copy and paste this URL into your browser and file will start downloading.  
![img5](/assets/img/post-content/65f9ebe5-a20f-402a-abfc-75dc068c3f2e.webp)

Voila!, You downloaded the PDF from PULMS.

---

I hope you liked this tutorial.
