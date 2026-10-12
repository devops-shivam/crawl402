# Security policy

crawl402 sits in front of payments, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead: go to the repository's **Security** tab and click **Report a vulnerability**.

Include what you found, how to reproduce it, and the impact you expect. You'll get an acknowledgement within a few days. Once a fix is released, you'll be credited in the changelog unless you'd rather not be.

## Scope

In scope: anything that lets a client get paid content without a valid payment, pay less than the price, redirect payments to another address, or crash the server through crafted headers.

Out of scope: crawlers that spoof their User-Agent to avoid detection (a known limit of user-agent matching, see the README), and issues in third-party facilitators.

## Supported versions

Only the latest 0.x release receives fixes until 1.0.
