# Deploy SeriesTracker on GitHub Pages

## Upload

1. Create a public GitHub repository, for example `trackerflix-main`.
2. Upload all files from this folder to the repository root.
3. Make sure `index.html`, `style.css`, `app.js`, `dragon-bg.jpg`, `.nojekyll`, `robots.txt`, and the SEO pages are in the root, not inside another folder.

## Enable GitHub Pages

1. Open the repository on GitHub.
2. Go to `Settings` -> `Pages`.
3. Under `Build and deployment`, choose:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
4. Save and wait for GitHub to publish.

Your temporary URL will look like:

```text
https://YOUR-USERNAME.github.io/trackerflix-main/
```

## After Publish

1. Add the GitHub Pages domain in Firebase Auth:
   `Firebase Console` -> `Authentication` -> `Settings` -> `Authorized domains`.
2. Replace `yourmail@gmail.com` in `contact.html` with your real contact email.
3. Update `robots.txt` with the live sitemap URL after you have the final GitHub Pages URL.
4. If you later buy a custom domain, add that domain in GitHub Pages and Firebase.
