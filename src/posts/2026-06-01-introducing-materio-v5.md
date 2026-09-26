---
title: Introducing Materio 5
layout: post
excerpt: Materio 5 brings a fully rebuilt search engine with smarter rankings, an upgraded AI Mode that searches inside PDFs, and Thinklet, a new AI study assistant with Materio built right in.
category: whats-new
date: 2026-06-01 00:00:00 +0530
hidden: false
image: "https://res.cloudinary.com/dvsdsl7iw/image/upload/v1780291254/insightroom/szthf1e5qdqcyqk8idvq.webp"
no-ads: true
hide_print: true
hide_author: true
---
Materio 5 brings changes across the board. Search has been rebuilt from the ground up with a new ranking algorithm, smarter AI Mode that goes inside your PDFs, and a Discovery Mode for when you don't know where to start. Navigation gets a fresh new modal that replaces the old dropdowns with a smoother, unified experience. We're also launching Thinklet, an AI study assistant built specifically around Materio, with a native integration right inside the PDF viewer. And on top of all that, a new wallpaper engine powered by Sereine brings a whole new level of personalization. Here's everything that's new in Materio 5.

## Search, Reimagined
Search launched in November 2025 and has been a core part of how people navigate Materio. It worked, but rankings were sometimes off. Queries with abbreviations, garbled text, or subject shorthand often returned vague or mismatched results.
In Materio 5, we've rebuilt search from the ground up. The core algorithm moves from string similarity matching to a keyword-based ranking model, the same approach used by industry-standard search engines. This means search now handles a much wider range of queries accurately, whether that's "Machine Learning chapter 2", "mad qb", or "DM pyq's".
Search is now reliable enough to be your primary way to navigate Materio.
![Search](https://res.cloudinary.com/dvsdsl7iw/image/upload/v1780285685/insightroom/hdmo6fedt6dyjjspydh5.png)

### AI Mode
AI Mode has been upgraded too. Previously it ran intent analysis on top of algorithmic results. Now it goes deeper: AI Mode uses Materio's MCP to search across your entire library, including the content inside PDFs, not just titles. It then builds a ranked index of the best matches and passes them through a re-ranker model before surfacing results.
This means you can ask things like "that one PDF with the OSI model diagram" or "which PDF covers Dijkstra's algorithm" and actually get the right answer.
![AI Search](https://res.cloudinary.com/dvsdsl7iw/image/upload/v1780285819/insightroom/mugzkivg9ljhzdcgny9b.png)

Note: AI Mode may be slightly slower due to API processing and inference latency.
### Discovery Mode
You can also ask Materio to suggest something to read. "What should I read today?" or "suggest something random" will return a topic based on your selected semester. Good for when you don't know where to start.
![Discovery Mode](https://res.cloudinary.com/dvsdsl7iw/image/upload/v1780284689/insightroom/bnfnjmkvjezruplqhjcz.png)

## New way to Navigate
Version 5 replaces the old dropdown menus with a new navigation modal. Instead of clicking through each dropdown individually, you tap one field and the rest of the selections transition smoothly on their own. The search bar is built right into this modal too, so browsing and searching now live in one place.
[video: https://res.cloudinary.com/dvsdsl7iw/video/upload/v1781430600/insightroom/llso5gdj8rrl6gacxr8h.webm]
This is still early and has a few rough edges, but it will get better with time.

## Thinklet
Alongside Materio 5, we're launching Thinklet: an AI chatbot built specifically for studying, with Materio MCP as a first-party integration.
Because Thinklet is built around Materio's MCP rather than bolted on, it follows tool rules more reliably and executes searches with better accuracy than third-party integrations.
![Home](https://res.cloudinary.com/dvsdsl7iw/image/upload/v1780283550/insightroom/m2fw5zy7lofsyij1dmbh.png)
Flexible AI providers. Thinklet lets you pick your own AI provider: OpenRouter, Google, OpenAI, Anthropic, DeepSeek, Qwen, and more. The default is OpenRouter with a curated set of models included. When you hit rate limits, you can bring your own API key (BYOK).
Context and memory. Thinklet retains conversation context, stores memory, and saves your chats to your account. Log in with your existing Materio credentials.
#### What Thinklet can do:

- Search the web
- Execute JavaScript
- Create and render web artifacts (HTML and React)
- Generate diagrams: flowcharts, FSMs, circuit diagrams, Gantt charts, 3D visualizations, plots, and more
- Upload images and files, including PDFs, and have Thinklet read and reason over them
- Generate worksheets, question banks, and sample papers from your study material
- Chat management. Your chats are saved to your account. You can share them publicly, generate private links, or use Incognito mode if you'd rather not save anything.

All Thinklet features are free for a limited time.
![Artifacts preview](https://res.cloudinary.com/dvsdsl7iw/image/upload/v1780283460/insightroom/cchxqutyqsuudiiatyeo.png)

## Thinklet in the PDF Viewer
The PDF viewer now has a native Thinklet integration. Click the icon in the top bar to open a side panel with Thinklet alongside your PDF. Or select any text in the PDF and tap "Ask AI" to send it directly to Thinklet for a quick explanation or doubt resolution.

![Thinklet in Materio](https://res.cloudinary.com/dvsdsl7iw/image/upload/v1780283755/insightroom/cmlki5uao3nzw1bdb0tk.png)

## A New Wallpaper Engine
Materio 5 brings a refreshed wallpaper engine with dynamic carousel support, pulling from Sereine, a curated art gallery. You can set wallpapers to change every time you open the app, once a day, or randomly throughout the day. Like any wallpaper to save it to your personal Wallpaper Store.

Sereine features over 3,800 artworks from artists across the design community on Twitter, spanning digital paintings, concept art, nature photography, and works from renowned artists like Claude Monet. It's a way to make Materio feel a little more yours.

![422dde55-4fc3-4e34-be78-74d76a4f9258.webp](https://res.cloudinary.com/dvsdsl7iw/image/upload/v1781527774/insightroom/gc2komlhy2o5s8rhmaps.webp)
