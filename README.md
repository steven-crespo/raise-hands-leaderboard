# Raise Hand Winners

A lightweight internal dashboard that visualizes daily standup
"raise hand winners" from Obsidian notes.

- Data source: Obsidian Daily Notes
- Views: Leaderboard + Calendar
- Hosted on GitHub Pages

## Update data
Ex: node extract.js "/Users/<user>/Documents/Obsidian Vault/Work/Daily Notes" "./site/data"

```bash
node extract.js "<path-to-vault>" "./site/data"
git commit -am "Update data"
git push