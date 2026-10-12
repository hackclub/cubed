---
title: Shipping & submitting
order: 10
section: Building
description: How to ship your Cubed project properly and submit it for review.
---

Shipping is almost as important as the project itself. A project that only
lives on your computer can't be shipped, and if it's not shipped properly,
it'll be rejected.

## What does shipped mean

Your project is public, open source, and usable by anyone. That means:

- **A public repo** with all your code
- **A good README** that explains what your project is, how you made it,
  and how to use or run it
- **A live demo** that anyone can try, like a website, a playable build,
  or a downloadable release
- **Minimal setup**. It shouldn't take more than 2 minutes for me to
  set up your project

---

## A good README

There should be a README.md file at the root of your repository. Here's a
good template:

````markdown
# Project name

A short description of what it does.

![screenshot](path/to/screenshot.png)

## Try it

https://example.com

## Features

- The thing it does
- The other thing it does

## Running locally

```bash
git clone https://github.com/your_username/your_project
cd your_project
npm install
npm run dev
```

## Built with

(insert whatever you built this with)
````

Feel free to modify this, or not use it at all (even better!). Make your
README as customized as possible with images, links, more about you, etc.

---

## Playable URL/Demo link

The Playable URL must be a publicly accessible link where anyone can
experience the project with minimal technical knowledge. The format
depends on what you built, so check the section for your project type
below.

### Web apps & sites

This is the easiest to set up and demo!

| Host | Good for | Notes |
| --- | --- | --- |
| GitHub Pages | Static sites | Free and simple, but no backend |
| Hack Club Nest | Anything, including backends and databases | Free for Hack Clubbers! Check out #nest on Slack |
| Vercel / Netlify | Next.js, React, static and serverless | Generous free tier and easily adds changes whenever you push to GitHub |

> Please don't use Streamlit, or anything that has a short limited free
> trial or has a long loading time.

### Games

- **Web playable is best.** Godot, Unity and Construct can all export to
  HTML5, so put it on GitHub Pages or itch.io and people can play it in
  their browser.
- If you have to ship a download, build for Windows, macOS and Linux, and
  attach them to a GitHub Release.
- Make sure to put the controls in your README so reviewers don't get
  confused.

### CLI tools & libraries

- Publish it on a package registry like npm, PyPI or crates.io.
- Also make a GitHub Release.

### Mobile apps

- Full Play Store/iOS App Store release
- Open/Closed/Internal test release (via TestFlight for iOS)
- Signed APK with sideloading instructions or IPA build with sideloading
  instructions

## AI & machine learning

Your project needs to be an app that people can use, with your model
already trained and ready to go. Reviewers should be able to open a link
and try it right away.

You cannot submit any notebooks (Jupyter, Google Colab, Kaggle) as your
demo, or anything that makes the reviewer train the model themselves.

Here are some good hosts to use! I personally recommend Hugging Face
Spaces

| Host | Good for | Notes |
| --- | --- | --- |
| [Hugging Face Spaces](https://huggingface.co/spaces) | Gradio apps, Docker apps, static sites | Made for ML. Use the free **CPU Basic** hardware. Free Spaces sleep when unused, so open yours right before you submit |
| [Hack Club Nest](https://hackclub.app) | FastAPI/Flask backends, bigger models | A free Linux server for Hack Club! It does have limited resources |

### Not acceptable:

- A GitHub release page that contains only source code.
- A project that requires the user to compile or build from source in order
  to run it.
- A Google Colab notebook, Jupyter notebook runner, or similar hosted
  notebook environment. These are development tools, not deployable project
  demos.
- LeetCode, competitive programming, or algorithmic challenge solutions
- Machine learning projects that force reviewers to retrain the model on
  their local laptop.

---

## Before you submit: checklist

Most rejections come from small things that take five minutes to fix.
Check these first!

- Your repo is public and has all your files
- Your README is detailed (At least 5 sentences)
- Your demo link works
- Your project fits [what counts as science](./what-counts)
- You picked the right Hackatime projects

## After you submit

A reviewer checks your project and decides how many hours to approve. This
can be less than what Hackatime shows if the hours don't match the work.
Reviews usually take less than 2 weeks.

If something small is wrong, like a private repo, a reviewer may DM you on
Slack so you can fix it. Or we will ping you in #cubed-ship

Once you're approved, you get 5 moles per approved hour!
