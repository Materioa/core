---
title: Dynamic Forms & Activity System — Configuration & Capabilities
layout: post
date: '2026-01-01 12:00:00'
category: Documentation
excerpt: "Documentation for the Materio Dynamic Forms system: JSON configuration, multi-page wizards, activity triggers, conditions, and field types."
summarize: true
permalink: /docs/forms-system
hidden: true
---

# Dynamic Forms & Activity System — Configuration & Capabilities

This document outlines the architecture and configuration of the Dynamic Forms system in Materio. This system allows for creating complex, multi-step forms (wizards) and triggering them based on user behavior (activity) without touching the code.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Form Configuration (`forms-config.json`)](#form-configuration)
4. [Activity Triggers (`formActivity.json`)](#activity-triggers)
5. [Wizard System](#wizard-system)
6. [Field Types](#field-types)
7. [API & Data Storage](#api--data-storage)
8. [Global Functions for Testing](#global-functions-for-testing)

---

## Overview

The forms system is split into two parts:
1.  **Forms Definition**: What the form looks like (fields, wizard pages, validation).
2.  **Activity Triggers**: When the form should appear (page load, visit count, user type).

It supports:
-   **Multi-page Wizards**: Cover pages (with video/image backgrounds), info pages, and form pages.
-   **Conditional Logic**: Show/hide fields based on other field values.
-   **Rich Media**: Video backgrounds, gradients, and animated icons.
-   **Device Targeting**: specific forms for mobile vs desktop.
-   **User Targeting**: target anonymous vs authenticated users.

## Architecture

| File | Purpose |
|------|---------|
| `assets/data/forms-config.json` | Defines the structure, fields, and wizard pages for each form. |
| `assets/data/formActivity.json` | Defines rules for *when* forms should automatically trigger. |
| `assets/scripts/forms.js` | Core logic for rendering, state management, and API submission. |
| `_includes/dynamic-forms.html` | HTML template and CSS styles for the modal. |
| `api/v2/features.js` | Backend handler for saving submissions to MongoDB and GitHub. |

## Form Configuration

Defined in `assets/data/forms-config.json`. The root object `forms` contains keys for each form ID.

### Basic Structure

```json
"contribution": {
    "id": "contribution",
    "title": "Community Contributions",
    "icon": "fa-regular fa-users",
    "description": "Form description...",
    "wizard": { ... },
    "fields": [ ... ],
    "submitButton": {
        "text": "Submit",
        "icon": "fa-paper-plane"
    }
}
```

### Wizard Configuration

Enable multi-step flows by adding a `wizard` object.

```json
"wizard": {
    "enabled": true,
    "pages": [
        {
            "id": "cover",
            "type": "cover",
            "backgroundImage": "/assets/media/video.webm", // Support for .webm, .mp4, .webp, .gif
            "backgroundGradient": "linear-gradient(...)",   // Overlay for video or fallback
            "title": "Welcome",
            "subtitle": "Get started",
            "icon": "fa-solid fa-star",
            "nextButton": { "text": "Start", "icon": "fa-arrow-right" }
        },
        {
            "id": "info",
            "type": "info",
            "title": "Why do this?",
            "content": [
                "Simple paragraph text is supported.",
                { "icon": "fa-user", "title": "Benefit 1", "description": "Details..." },
                { "title": "Just Text", "description": "No icon needed for simple blocks." }
            ],
            "continueButton": { "text": "Next" },
            "exitButton": { "text": "Exit" }
        },
        {
            "id": "form",
            "type": "form",
            "title": "Enter Details"
        }
    ]
}
```

### Supported Media
-   **Images**: `.webp`, `.png`, `.jpg`, `.jpeg`, `.gif` (animated)
-   **Video**: `.webm`, `.mp4`, `.mov`, `.ogg` (auto-plays, loops, muted)

When using video, the `backgroundGradient` is applied as a semi-transparent overlay (85% opacity) to ensure text legibility.

## Activity Triggers

Defined in `assets/data/formActivity.json`.

### Trigger Structure

```json
{
    "id": "satisfaction-survey",
    "enabled": true,
    "formType": "satisfaction",  // Must match ID in forms-config.json
    "trigger": {
        "type": "pageLoad",
        "delay": 3000,           // Wait 3s after load
        "conditions": {
            "minVisits": 3,      // User must have visited 3 times
            "minDaysSinceFirstVisit": 1,
            "pages": ["home"],   // Only trigger on home page
            "userType": "any"    // "any", "authenticated", "anonymous"
        }
    },
    "frequency": "every-30days", // "once", "everytime", "every-visit", "daily", "weekly"
    "priority": 1                // Lower number = higher priority
}
```

### Frequency Options
-   `once`: Show only once ever (persisted in localStorage).
-   `everytime` / `every-visit`: Show on every eligible page load.
-   `daily` / `every-24hr`: Once every 24 hours.
-   `weekly`: Once every 7 days.
-   `monthly` / `every-30days`: Once every 30 days.

## Field Types

The system supports various field types in the `fields` array:

| Type | Properties |
|------|------------|
| `text` | `name`, `label`, `placeholder`, `required`, `minLength` |
| `textarea` | same as text + `maxLength` |
| `email` | standard email validation |
| `select` | `options` ([{value, label}]), `allowOther` (adds "Other" option) |
| `rating` | `max` (default 5), stars turn orange (#ff8200) on selection |
| `file` | `accept` (.pdf), `multiple`, `maxSize` (bytes) |

### Conditional Logic
Fields can show/hide based on other values using `showWhen`:

```json
"showWhen": {
    "field": "userIdentity",
    "value": "github"
}
```

## API & Data Storage

-   **General Forms**: Submitted to `/api/v2/features?action=forms`. Saved to MongoDB `forms` collection.
-   **File Uploads**: Submitted to `/api/v2/features?action=contribute`. Files pushed to GitHub repo, metadata saved to MongoDB.

**User Identity**:
-   The system automatically checks `localStorage.getItem('materio_user')`.
-   If found, the user object is attached to the submission, even for anonymous forms.
-   In forms with an "Identity" dropdown, "Materio Account" is pre-selected if logged in.

## Global Functions for Testing

You can use these in the browser console:

| Function | Description |
|----------|-------------|
| `openDynamicForm('formId', skipWizard)` | Open a form. Pass `true` as 2nd arg to skip wizard intro. |
| `triggerFormActivityById('activityId')` | Test a specific activity trigger logic. |
| `submitDynamicForm()` | Programmatically submit the currently open form. |
| `goToWizardPage(index)` | Jump to a specific wizard step (0-based index). |
| `resetDynamicForm()` | Clear all fields and validation states. |
