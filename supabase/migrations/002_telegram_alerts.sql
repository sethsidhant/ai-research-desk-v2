-- Add Telegram chat ID to user alert preferences
ALTER TABLE user_alert_preferences ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
