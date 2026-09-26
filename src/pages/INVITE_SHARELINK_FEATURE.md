# Invite Sharelink Feature

This feature enhances the invite management system by replacing the simple "copy" functionality with a comprehensive "share" system that allows custom headings and social media sharing.

## Features Added

### 1. Dynamic Invite Pages
- Custom invite pages are now generated dynamically via API
- URL format: `/invites/{invite-code}`
- Uses existing invite layout but with dynamic content

### 2. Share Modal
- Replaces the copy button in the actions column with a share button
- Modal includes:
  - Read-only URL display with copy button
  - Custom heading input with template dropdown
  - Update button to save custom heading
  - Social sharing options (Copy Link, WhatsApp, X/Twitter)

### 3. Custom Heading Templates
Available templates in dropdown:
- `{name}, You have been invited to try`
- `Welcome {name}! Join us on`
- `Hey {name}, check this out`
- `Special invitation for {name}`

The `{name}` placeholder is currently replaced with "friend" in dynamic pages.

### 4. Social Sharing
- **Copy Link**: Copies the invite URL to clipboard
- **WhatsApp**: Opens WhatsApp with pre-filled message
- **X (Twitter)**: Opens Twitter with pre-filled tweet

## API Endpoints

### POST `/api/v2/features?action=sharelink`
Creates or updates a sharelink with custom heading.

**Request Body:**
```json
{
  "inviteCode": "ABCD1234",
  "customHeading": "Welcome {name}! Join us on"
}
```

**Response:**
```json
{
  "message": "Sharelink created successfully",
  "sharelink": {
    "inviteCode": "ABCD1234",
    "customHeading": "Welcome {name}! Join us on",
    "url": "http://localhost:8888/invites/ABCD1234",
    "createdAt": "2025-01-XX...",
    "updatedAt": "2025-01-XX..."
  }
}
```
*Note: URL will be `https://materioa.netlify.app/invites/ABCD1234` in production*

### GET `/invites/{invite-code}`
Serves the dynamic invite page with custom heading (if set).

## Database Schema

### `sharelinks` Table
```sql
CREATE TABLE sharelinks (
    id SERIAL PRIMARY KEY,
    invite_code VARCHAR(255) NOT NULL UNIQUE,
    custom_heading TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Files Modified

### Backend
- `api/v2/features.js` - Added sharelink endpoint (merged from sharelink.js)
- `api/invites.js` - New dynamic route handler
- `netlify.toml` - Added redirect rule for dynamic routes
- `migrations/create_sharelinks_table.sql` - Database migration

### Frontend
- `account/profile.html` - Added share modal HTML and CSS
- `account/js/profile.js` - Added share modal functionality

## Installation

1. **Run the database migration:**
   ```sql
   -- Execute the contents of migrations/create_sharelinks_table.sql
   ```

2. **Deploy or restart your development server:**
   ```bash
   npm run dev
   ```

3. **Test the feature:**
   - Login as admin
   - Generate an invite
   - Click the new share icon (🔗) instead of copy
   - Test custom headings and social sharing

## Usage

1. **Create an invite** using the existing generate button
2. **Click the share icon** in the actions column (replaces copy icon)
3. **Customize the heading** using templates or manual input
4. **Click "Update Share Link"** to save the custom heading
5. **Share the URL** using the provided social sharing buttons

## Backward Compatibility

- Existing static invite files in `plus_invites/` continue to work
- Existing invite codes work with both static and dynamic routes
- All existing invite functionality remains unchanged

## Notes

- The `{name}` placeholder is currently replaced with "friend" for dynamic pages
- For personalized names, this could be extended with URL parameters in the future
- All sharing respects the same access control as existing invite system
- Custom headings are stored per invite code and can be updated anytime