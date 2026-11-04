# Diwali Afterparty invite

Static invite page for Thu, Nov 5, 2026 at Garden Alameda, San Jose. Hosted on GitHub Pages:
https://parvpatodia.github.io/diwali-afterparty/

- `index.html`: the whole page. Opens with a canvas burn reveal, then fireworks, then the details and an RSVP form.
- `gifs/scream.gif`: hero clip, from a YouTube upload of IShowSpeed reacting to the "Happy Diwali" song.
- `og.jpg`: link preview image for WhatsApp, iMessage and similar apps.
- `rsvp-sheet.gs`: Google Apps Script that receives RSVPs and writes them to a Google Sheet.

## RSVP setup

1. Create a Google Sheet. Open Extensions > Apps Script, paste `rsvp-sheet.gs`, save.
2. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the `/exec` URL.
3. Put that URL in `RSVP_URL` in `index.html`, commit, push.

Each browser gets a random device id, so a guest who changes their answer updates their row instead of adding a second one. Totals are in F1:I1 of the `RSVPs` tab.

## Local check

Open `index.html` in a browser. People with reduced motion turned on skip the burn and fireworks.
