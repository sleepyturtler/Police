# Police---DC-Bot
The ultimate moderation bot for discord.
# Commands
## Moderation:
- **/warning give:** Gives a warning through a guided message: pick the warning path, then the offense, add optional details, and confirm. The confirmation shows the role, the member's existing warnings on that path and what escalation this warning triggers. Give a `level` to skip the guide.
- **/warning remove:** Manually removes the selected warning from a user.
- **/timeout give:** Gives a configurable length timeout to a user.
- **/timeout remove:** Remove the timeout from a user.
- **/kick:** Kicks the user
- **/ban give:** Bans the user and deletes their messages in the last (configurable time). Can also be set to unban after set time.
- **/ban remove:** Unbans the user.
## Config:
- **/config warnings:** One panel with tabs for **Levels** (add or remove a warning level: a role and how long it lasts), **Escalation** (rules, timeout rules and the level cap), **Offenses** (the list moderators pick from, each with a reason and a suggested level) and **Paths**.
- **/config settings:** One panel for the access role (who can use the mod commands, admins always can), the mod-log channel and DM notifications.
## Warning paths:
- A path is its own ladder: separate levels, escalation rules, cap and offenses. Use one for Discord offenses and another for in-game offenses. Strikes never count across paths.
- Add the Discord or In-game preset (with example offenses you can edit) or a custom path from the Paths tab. Up to 5 paths per server and 20 offenses per path.
- A server set up before paths existed keeps its levels as a path called Discord. Nothing is rewritten: the old settings are copied on the first edit and the originals are left alone.
## Escalation:
- **/escalation set:** Configure how many level X warnings you need to automatically bump up to a level Y.
- **/escalation cap:** Sets the cap of the warnings, where any additional warning won't escalate.
- **/escalation timeout:** Adds a special threshold where the user gets a configurable timeout.
- **/escalation view:** Opens the Escalation tab of the warnings panel.
- Every escalation command takes an optional `path` (it autocompletes). The Escalation tab does the same with buttons.
## Scam Protection:
- **/scam add:** Upload a known scam image to register it. Any similar image posted in the server will be automatically removed.
- **/scam config:** Configure scam protection settings including enabling/disabling detection, whether to delete messages, timeout duration, and match strictness (0 to 8, default 6, lower is stricter).
- **/scam list:** Lists all registered scam images with their IDs, labels, who added them and let's you delete them.
- **Matching:** each registered image stores a dHash, a pHash and a 32x32 thumbnail. A post only counts as a match when the thumbnails correlate strongly and the hashes agree, so unrelated screenshots with a similar layout do not trigger it. Images registered before this change keep working under stricter rules; run `/scam add` with the same image again to upgrade them in place.
## Sting Operation:
- **/sting setup:** Creates a trap channel that everyone can see and post in. Real members have no reason to post there, spam bots and hijacked accounts do.
- **/sting channel:** Uses an existing channel as the trap instead.
- **/sting action:** Picks the punishment: delete only (their last 24h of messages), timeout + delete, softban (ban then unban, deletes last 24h) or ban (permanent, deletes last 24h). The timeout length is configurable.
- **/sting options:** Turn the warning message in the channel on or off, and optionally rename the channel to a random name every day.
- **/sting view / disable:** Shows the settings and anything that needs attention, or turns the trap off.
- Staff are never punished (Administrator, Manage Messages, Manage Server or the access role), so test it with an alt account. Hits are logged to the mod-log channel and added to the user's history.
## Spam Protection:
- **/spam config:** Configure spam detection settings including enabling/disabling, how many similar messages trigger it, the time window, similarity threshold, whether to delete messages, and timeout duration.
- **/spam view:** Shows the current spam protection configuration.
## Cross-channel Protection:
- **/crosspost config / view:** Catches the same message or image pasted into several channels. Administrators are ignored.
## Messages:
- **/messages delete:** Delete messages in one channel with filters like only deleting from a specific user, deleting in the last x hours and setting the amount of messages deleted.
- **/messages purge:** Delete all of the selected users messages across all channels that were sent in the last x hours.
- **Deleting:** Discord only bulk-deletes messages under 14 days old and refuses a whole batch if one message in it cannot be deleted. The bot retries a refused batch one message at a time, deletes older messages one by one (up to `DELETE_OLD_MAX`, default 200, per run), sweeps several channels at once, and reports what it could not finish (permissions, scan limit, time limit) instead of claiming success.
## Admin:
- **/warning history:** Shows the warning history of a specific user.
- **/warning list:** Shows all active warning in the server.
- **/userinfo:** View account info, roles, active warnings, warn counts per level, kicks, bans, and notes for any user.
## Notes:
- **/note add:** Adds a note to a user.
- **/note remove:** Views all of the users notes and gives you the option to delete them.
## Other
- **/help:** Shows all commands available.
- **/mywarnings:** Shows you how much time is left on your warnings.
- **/invite:** Creates an invite for the bot with all the permissions the bot needs.

# AI Use:
- The bot is mostly vibecoded with Claude, however
- A lot of effort, manual bugtesting and time has went into making this bot super polished.
- The bot is something I am passionate about, and me using AI does not change the fact that I worked very hard to make it.