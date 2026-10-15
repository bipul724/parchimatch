# Publish the static documentation site

The local ParchiMatch app stays on the shop computer. This workflow publishes only `site/`; it does not host the app or shop data. There is no build step or npm install.

## GitHub UI steps

1. Commit `site/` and `.github/workflows/pages.yml` and push them to `main` when ready to publish.
2. Open [bipul724/parchimatch](https://github.com/bipul724/parchimatch) → **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open **Actions** → **Deploy documentation to GitHub Pages**. The next push to `main` deploys automatically. To deploy the current commit, choose **Run workflow**, select `main`, then **Run workflow**.
5. Wait for the deployment job to succeed. Open **Settings → Pages → Visit site** or the deployment URL:

   **https://bipul724.github.io/parchimatch/**

The workflow uses the official `configure-pages`, `upload-pages-artifact` and `deploy-pages` actions, with `contents: read`, `pages: write` and `id-token: write`, and the `github-pages` environment. See [GitHub’s custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The canonical and social tags, `robots.txt` and `sitemap.xml` already use the GitHub Pages base `https://bipul724.github.io/parchimatch/`, with each page or asset suffix. Paths to site assets and navigation are relative, so nothing else needs changing for the default deployment.

## A custom domain later

Use a domain you control, such as `example.tech`. No current free-domain offer is assumed.

1. Verify ownership in your GitHub account’s Pages settings. In this repository’s **Settings → Pages → Custom domain**, enter the domain and **Save** before changing DNS.
2. At the DNS provider, point a `www` CNAME record to `bipul724.github.io` (without `/parchimatch/`). For an apex domain, set these A records:

   ```text
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```

3. Replace the base URL `https://bipul724.github.io/parchimatch/` in the canonical/social tags, `robots.txt` and `sitemap.xml` with your HTTPS domain. Once DNS validation and the certificate are ready, enable **Enforce HTTPS** in **Settings → Pages**.

`site/CNAME` has deliberately not been created. For branch publishing, that conventional file would contain only the chosen domain, such as `example.tech`, on one line. With this custom GitHub Actions workflow, GitHub ignores `CNAME` files and does not require one: **Settings → Pages → Custom domain is authoritative**. Adding a file alone does not configure a domain. See [GitHub’s domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site), [CNAME guidance](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages) and [HTTPS guide](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

## Demo video

Add your real recording at `site/assets/demo.mp4`, then commit it when ready. No fake or empty MP4 is shipped. The local poster is shown until the recording is available; the site does not embed a third-party video player.
