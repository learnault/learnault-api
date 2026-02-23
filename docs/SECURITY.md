# Security Policy for Learnault

## Overview

Learnault is committed to protecting the security and integrity of our platform, users, and community. We take security vulnerabilities seriously and appreciate the efforts of security researchers and community members who help us maintain a safe environment.

This document outlines our security practices, how to report vulnerabilities, and what to expect when you report a security issue.

---

## Supported Versions

We currently support the following versions of Learnault with security updates:

| Version     | Supported | Status                                       |
| :---------- | :-------- | :------------------------------------------- |
| 1.0.x       | ✅ Yes    | Active development                           |
| 0.x         | ❌ No     | Beta versions - upgrade recommended          |
| Main branch | ✅ Yes    | Latest development, security patches applied |

**Note:** Always use the latest stable version. Beta versions and the main branch may contain unreviewed changes.

---

## Reporting a Vulnerability

### Preferred Method: Private Report

**PLEASE DO NOT REPORT SECURITY VULNERABILITIES THROUGH PUBLIC GITHUB ISSUES, DISCORD, OR SOCIAL MEDIA.**

Instead, please report security vulnerabilities privately to our security team:

**security@toneflix.net**

### What to Include

1. To help us respond quickly and effectively, please include:
2. Description: Clear description of the vulnerability
3. Impact: What an attacker could potentially do
4. Steps to Reproduce: Detailed steps with screenshots if helpful
5. Affected Versions: Which versions are impacted
6. Environment: Browser, OS, device details if applicable
7. Proof of Concept: Code snippets or demonstrations
8. Suggested Fix: If you have ideas for remediation
9. Your Contact: How to reach you for follow-up (email, Signal, etc.)

### Response Timeline

| Stage                  | Expected Timeframe      |
| :--------------------- | :---------------------- |
| **Acknowledgment**     | Within 24 hours         |
| **Initial Assessment** | Within 72 hours         |
| **Status Update**      | Weekly until resolution |
| **Fix Development**    | Depends on severity     |
| **Public Disclosure**  | After fix is deployed   |

---

## Scope

### In Scope

The following assets are in scope for security reporting:

**Core Platform:**

- Smart contracts (`https://github.com/learnault/contracts/`)
- Backend API (`https://github.com/learnault/api/`)
- Frontend application (`https://github.com/learnault/learnault/`)
- Authentication and authorization systems
- Reward distribution mechanisms
- Wallet integration

**Infrastructure:**

- Production servers and services
- Database systems
- CI/CD pipelines
- Domain names and DNS

### Out of Scope

The following are generally out of scope:

- Issues requiring physical access to user devices
- Social engineering of Learnault team members
- Denial of service attacks (report these, but we handle separately)
- Theoretical vulnerabilities without proof of concept
- Issues in dependencies that are already reported upstream
- Previously reported issues (unless still unfixed)
- Features marked as "experimental" or "beta"

---

## Bug Bounty Program

We offer bug bounties for qualifying security vulnerabilities. The bounty amount depends on severity and impact.

### Bounty Tiers

| Severity          | Description                                      | Bounty Range     |
| :---------------- | :----------------------------------------------- | :--------------- |
| **Critical**      | Direct loss of funds, complete system compromise | $5,000 - $10,000 |
| **High**          | Significant security breach, data exposure       | $2,000 - $5,000  |
| **Medium**        | Limited impact, requires user interaction        | $500 - $2,000    |
| **Low**           | Minor issues, limited scope                      | $100 - $500      |
| **Informational** | Best practices, theoretical risks                | Recognition only |

### Bounty Eligibility

✅ **Eligible:**

- First-time reporters of valid, in-scope vulnerabilities
- Clear, reproducible reports
- Responsible disclosure (no public disclosure before fix)

**Not Eligible:**

- Duplicate reports
- Issues already known to the team
- Automated tool outputs without analysis
- Self-reported vulnerabilities by team members
- Violations of our disclosure policy

### Payment Methods

- **USDC** (preferred - via Stellar)
- **XLM**
- **Bank transfer** (for larger amounts)
- **Gift cards** (Amazon, etc. - for smaller amounts)

---

## Security Best Practices for Users

### For Learners

1. **Wallet Security**
   - Never share your private keys or seed phrases
   - Use strong, unique passwords
   - Enable two-factor authentication (2FA) when available
   - Keep recovery phrases offline and secure

2. **Account Protection**
   - Verify email confirmations come from @learnault.io
   - Be cautious of phishing attempts
   - Log out from shared devices
   - Monitor your wallet for unauthorized transactions

3. **Safe Learning**
   - Only access Learnault through official channels
   - Report suspicious modules or content
   - Be wary of users asking for personal information

### For Employers (B2B)

1. **API Security**
   - Rotate API keys regularly
   - Use IP whitelisting where possible
   - Implement rate limiting on your end
   - Monitor for unusual API usage patterns

2. **Data Protection**
   - Only request necessary candidate information
   - Securely store any downloaded credential data
   - Comply with local data protection laws (GDPR, etc.)

---

## Security Architecture

### Smart Contract Security

Our Soroban smart contracts implement:

- **Access Control**: Only authorized issuers can mint credentials
- **Immutability**: Credentials cannot be altered once issued
- **Revocation**: Ability to revoke compromised credentials
- **Pausability**: Emergency pause functionality for critical issues
- **Formal Verification**: Critical contracts are formally verified

### API Security

- **Authentication**: JWT-based with short expiration
- **Rate Limiting**: Prevents abuse and DoS attacks
- **Input Validation**: All inputs sanitized and validated
- **SQL Injection Protection**: Parameterized queries via Prisma
- **CORS**: Strict cross-origin resource sharing policies

### Infrastructure Security

- **HTTPS/TLS**: All traffic encrypted in transit
- **AWS Security Groups**: Minimal exposure, principle of least privilege
- **Regular Backups**: Encrypted, tested recovery procedures
- **DDoS Protection**: CloudFlare or similar protection
- **WAF**: Web Application Firewall for common attack patterns

---

## Responsible Disclosure Policy

We ask that security researchers follow these guidelines:

1. **Report Privately**: Send details to security@learnault.io first
2. **Give Us Time**: Allow reasonable time to fix before public disclosure
3. **Make Good Faith Efforts**: Avoid privacy violations, data destruction, or service interruption
4. **Provide Details**: Quality reports help us fix faster
5. **No Extortion**: We will not pay ransoms or threats

### Disclosure Timeline

- Day 0 - Report received and acknowledged
- Day 1-3 - Initial assessment and severity determination
- Day 4-14 - Fix development (depending on severity)
- Day 15 - Fix deployed to production
- Day 16 - Public disclosure (coordinated with reporter)

---

## Known Security Considerations

### Blockchain-Specific Risks

| Risk                               | Mitigation                                       |
| :--------------------------------- | :----------------------------------------------- |
| **Smart contract vulnerabilities** | Multiple audits, bug bounty, formal verification |
| **Private key compromise**         | User education, hardware wallet support planned  |
| **Network congestion**             | Transaction queueing, retry logic                |
| **Stellar network issues**         | Monitoring, fallback procedures                  |

### Platform Risks

| Risk                 | Mitigation                                       |
| :------------------- | :----------------------------------------------- |
| **Account takeover** | 2FA, suspicious activity monitoring              |
| **Phishing attacks** | User education, domain monitoring                |
| **Data breach**      | Encryption, minimal data collection              |
| **DDoS attacks**     | CloudFlare protection, rate limiting             |
| **Sybil attacks**    | Verification requirements, rate limiting rewards |

## Secure Development Lifecycle

We follow these security practices in development:

1. **Threat Modeling**: Identify risks before coding
2. **Secure Coding Guidelines**: All developers must follow
3. **Code Review**: Every PR reviewed, with security focus
4. **Automated Scanning**: SAST, DAST, dependency scanning
5. **Testing**: Unit, integration, and security tests
6. **Staging Environment**: Test in production-like environment
7. **Security Sign-off**: Required before major releases

### Automated Security Tools

| Tool                       | Purpose                 | Frequency    |
| :------------------------- | :---------------------- | :----------- |
| **SonarQube**              | Code quality & security | Every PR     |
| **Snyk**                   | Dependency scanning     | Daily        |
| **ESLint Security Plugin** | JavaScript security     | Every commit |
| **Trivy**                  | Container scanning      | Every build  |
| **OWASP ZAP**              | DAST scanning           | Weekly       |

---

## Emergency Contact

For **critical security emergencies** (active attack, compromised systems, etc.):

| Method              | Contact                | Availability   |
| :------------------ | :--------------------- | :------------- |
| **Emergency Phone** | +1 (555) 123-4567      | 24/7           |
| **Signal**          | @learnault.123         | 24/7           |
| **Email**           | emergency@learnault.io | Monitored 24/7 |
| **Discord**         | @security-lead (ping)  | Business hours |

For non-emergencies, please use security@learnault.io.

_Last updated: February 2026_

---

## Policy Updates

This security policy may be updated periodically. Significant changes will be announced via:

- GitHub Security Advisories
- Discord #announcements channel
- Email to registered security contacts

**Version:** 1.0
**Last Updated:** February 18, 2026
**Next Review:** May 2026

---

## Contact Information

**Security Team:** security@toneflix.net

---

_Thank you for helping keep Learnault and our community safe!_ 🛡️
