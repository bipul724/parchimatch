# ParchiMatch Lite static website

Open `index.html` directly, or preview from the repository root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory site
```

Then open `http://127.0.0.1:8000/`. Hosting needs only these static files; Python is an optional local preview tool. There is no build step, framework, npm installation or third-party asset request.

- [Claim sources](CLAIMS.md)
- [Verification, size and complete external-link inventory](QA.md)
- [GitHub Pages and custom-domain steps](DEPLOYMENT.md)
- [Local assets and the real-video slot](assets/README.md)

Canonical/social metadata, robots and sitemap use the GitHub Pages base `https://bipul724.github.io/parchimatch/`. Internal and asset paths are relative. No `CNAME` file has been created; a custom domain would mean replacing that base URL (see [DEPLOYMENT.md](DEPLOYMENT.md)).

Outstanding publishing questions:

1. The canonical base is the GitHub Pages URL. If a custom domain is set up later, switch the base URL as described in DEPLOYMENT.md.
2. Will the real demo recording contain speech that needs a local caption track? The current poster has no audio and is explicitly a placeholder.

The underlying tool, tests, data and existing docs are unchanged by this website work.

### Community Wisdom: [Accessible Web Apps: A Div Is Not a Button](https://dev.to/peralov/accessible-web-apps-a-div-is-not-a-button-5gf9)
> **Source**: [peralov](https://dev.to/peralov)
> **Tags**: `webdev`, `frontend`, `a11y`, `html`
>
> The author's accessibility-remediation experience supports using native buttons and disclosure elements for keyboard behavior. The retrieved comment agreed. This is practical supporting context, not a complete accessibility audit; product claims come only from the repository and supplied brief.
>
> [Read Full Discussion](https://dev.to/peralov/accessible-web-apps-a-div-is-not-a-button-5gf9)
