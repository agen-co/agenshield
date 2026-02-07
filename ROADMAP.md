## ✅ ROADMAP

### OpenClaw Integration

* [ ] Original OpenClaw folder is copied **without any modifications**
* [ ] Default OpenClaw daemon is stopped
* [ ] OpenClaw is managed exclusively by **AgentShield’s daemon**
* [ ] OpenClaw CLI is controllable via `npx agentshield openclaw ...`
* [ ] OpenClaw is controllable from the **web interface**
* [ ] System status is displayed correctly:

  * OpenClaw running outside AgentShield
  * OpenClaw running under AgentShield
  * OpenClaw not running

---

### Environment Variables & Secrets

* [ ] Environment variables are automatically displayed based on **active skills**
* [ ] Environment variable injection works correctly at:

  * [ ] Global scope
  * [ ] Policy scope
* [ ] Missing secrets derived from active skills are added
* [ ] When removing a skill, the user is prompted to **delete or keep its secrets**
* [ ] Secrets can be pulled from the **original active skills**
* [ ] Secrets are assigned to the correct commands derived from each skill
* [ ] Secrets are removed from the `.openclaw` config file to restrict environment access

---

### Policies & Skills

* [ ] Policy command autocomplete is based on **active skills**
* [ ] “Skill” option is removed from policies
* [ ] Skill-to-command mapping exists **only** in the Secrets view
* [ ] Policies do not disappear after installing skills
* [ ] Skills cannot be added outside of AgentShield

---

### UI & Visibility

* [ ] Full canvas is displayed in the overview screen
* [ ] AgentShield UI shows alerts for **denied access**
* [ ] Denied actions can be easily approved from the UI
* [ ] Audit logs are clearly visible
* [ ] Audit log filtering works correctly

---

### Security & Elevated Access

* [ ] `SUDO_MODE` is supported for **limited-time usage**
* [ ] `SUDO_MODE` does **not** grant real sudo access
* [ ] `SUDO_MODE` applies a temporary wildcard policy only
* [ ] `SUDO_MODE` is usable for trusted operations (e.g., OpenClaw installation)
