const RAW_API_BASE = "https://raw.is-a.dev";
const FULL_DATA_URL = `${RAW_API_BASE}/v2.json`;

function formatNumber(num) {
    return Number(num).toLocaleString("en-US");
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/* ---------------------------- WHOIS Query ---------------------------- */

let fullDataPromise = null;

function loadFullData() {
    if (!fullDataPromise) {
        fullDataPromise = fetch(FULL_DATA_URL).then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        });
    }
    return fullDataPromise;
}

function normalizeQuery(raw) {
    let query = raw.trim().toLowerCase();
    query = query.replace(/^https?:\/\//, "").split("/")[0];
    query = query.replace(/\.is-a\.dev$/, "");
    query = query.replace(/^\.+|\.+$/g, "");
    return query;
}

function isValidSubdomain(query) {
    return /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(query);
}

function formatRecordValue(value) {
    if (Array.isArray(value)) return value.map(formatRecordValue);
    if (value !== null && typeof value === "object") {
        return Object.entries(value)
            .map(([key, val]) => `${key}: ${val}`)
            .join(", ");
    }
    return String(value);
}

function buildWhoisText(status, data, query) {
    const domain = data?.domain || `${query}.is-a.dev`;
    const lines = [];

    if (status === "AVAILABLE") {
        lines.push(`Domain:     ${domain}`);
        lines.push("Status:     AVAILABLE");
        lines.push("");
        lines.push(`No match found for "${domain}".`);
        lines.push("This subdomain may be available to register: https://docs.is-a.dev");
    } else {
        lines.push(`Domain:     ${domain}`);
        lines.push(`Status:     ${status}`);

        if (data?.owner?.username) lines.push(`Owner:      ${data.owner.username}`);
        if (data?.owner?.email) lines.push(`Owner Mail: ${data.owner.email}`);
        if (data?.description) lines.push(`Description: ${data.description}`);
        if (status === "REGISTERED") {
            lines.push(`Proxied:    ${data?.proxied ? "Yes" : "No"}`);
            if (data?.redirect_config) lines.push("Redirects:  Enabled (custom paths)");
        }

        const records = data?.records || {};
        const recordTypes = Object.keys(records);
        if (recordTypes.length) {
            lines.push("");
            lines.push("Records:");
            for (const type of recordTypes.sort()) {
                const values = formatRecordValue(records[type]);
                const list = Array.isArray(values) ? values : [values];
                for (const value of list) {
                    lines.push(`  ${type.padEnd(8)} ${value}`);
                }
            }
        }
    }

    lines.push("");
    lines.push("**This data is provided for information purposes only.");
    lines.push("By using this service you agree not to scrape or harvest data from this website.**")

    return lines.join("\n");
}

function renderResult(status, data, query) {
    const result = document.getElementById("result");
    const statusEl = document.getElementById("result-status");
    const domainEl = document.getElementById("result-domain");
    const ownerEl = document.getElementById("result-owner");
    const outputEl = document.getElementById("whois-output");
    const recordsCard = document.getElementById("records-card");
    const recordsList = document.getElementById("records-list");

    const domain = data?.domain || `${query}.is-a.dev`;

    statusEl.textContent = status;
    statusEl.classList.remove("text-[var(--accent)]", "text-emerald-400", "text-amber-400");
    if (status === "AVAILABLE") statusEl.classList.add("text-emerald-400");
    else if (status === "RESERVED") statusEl.classList.add("text-amber-400");
    else statusEl.classList.add("text-[var(--accent)]");

    domainEl.textContent = domain;

    const username = data?.owner?.username;
    if (username) {
        ownerEl.innerHTML = `<a href="https://github.com/${encodeURIComponent(username)}" target="_blank" rel="noopener" class="hover:underline">${escapeHtml(username)}</a>`;
    } else {
        ownerEl.textContent = status === "AVAILABLE" ? "-" : "Unknown";
    }

    outputEl.textContent = buildWhoisText(status, data, query);

    const records = data?.records || {};
    const recordTypes = Object.keys(records);
    if (recordTypes.length) {
        recordsList.innerHTML = recordTypes
            .sort()
            .map((type) => {
                const values = formatRecordValue(records[type]);
                const list = Array.isArray(values) ? values : [values];
                const rendered = list
                    .map((value) => `<span class="terminal-text text-gray-400 break-all">${escapeHtml(value)}</span>`)
                    .join("");
                return `
          <li class="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
            <span class="font-semibold">${escapeHtml(type)}</span>
            <span class="flex flex-col gap-1 sm:text-right">${rendered}</span>
          </li>
        `;
            })
            .join("");
        recordsCard.classList.remove("hidden");
    } else {
        recordsCard.classList.add("hidden");
    }

    result.classList.remove("hidden");
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function performQuery(rawQuery) {
    const queryLoading = document.getElementById("query-loading");
    const queryError = document.getElementById("query-error");
    const result = document.getElementById("result");

    const query = normalizeQuery(rawQuery);

    queryError.classList.add("hidden");
    result.classList.add("hidden");

    if (!query) {
        history.replaceState(null, "", location.pathname + location.search);
        return;
    }

    if (!isValidSubdomain(query)) {
        queryError.textContent = `"${rawQuery.trim()}" is not a valid is-a.dev subdomain.`;
        queryError.classList.remove("hidden");
        return;
    }

    queryLoading.classList.remove("hidden");

    try {
        const response = await fetch(`${RAW_API_BASE}/v2/domains/${encodeURIComponent(query)}.json`);

        if (response.ok) {
            const data = await response.json();
            renderResult(data.reserved ? "RESERVED" : "REGISTERED", data, query);
        } else if (response.status === 404) {
            // Not served individually - check the full dataset for reserved entries
            let entry = null;
            try {
                const all = await loadFullData();
                entry = all.find((item) => item.subdomain?.toLowerCase() === query) || null;
            } catch {
                // Full dataset unavailable, fall through to AVAILABLE
            }

            if (entry && entry.reserved) renderResult("RESERVED", entry, query);
            else if (entry) renderResult("REGISTERED", entry, query);
            else renderResult("AVAILABLE", null, query);
        } else {
            throw new Error(`HTTP ${response.status}`);
        }

        history.replaceState(null, "", `#${encodeURIComponent(query)}`);
    } catch (err) {
        queryError.textContent = `Failed to process query: ${err.message}`;
        queryError.classList.remove("hidden");
    } finally {
        queryLoading.classList.add("hidden");
    }
}

/* ------------------------- GitHub User Query ------------------------- */

const GITHUB_API_BASE = "https://api.github.com/users";

function normalizeUsername(raw) {
    let query = raw.trim();
    query = query.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
    query = query.split("/")[0].replace(/^@/, "");
    return query.toLowerCase();
}

function isValidUsername(query) {
    return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/.test(query);
}

async function fetchUserProfile(username) {
    const response = await fetch(`${GITHUB_API_BASE}/${encodeURIComponent(username)}`);
    if (!response.ok) return null;
    return response.json();
}

function formatUserDomainRecord(value) {
    if (Array.isArray(value)) return value.join(", ");
    if (value !== null && typeof value === "object") {
        return Object.entries(value)
            .map(([key, val]) => `${key}: ${val}`)
            .join(", ");
    }
    return String(value);
}

function renderUserResult(username, profile, domains) {
    const userResult = document.getElementById("user-result");
    const avatarEl = document.getElementById("user-avatar");
    const nameEl = document.getElementById("user-name");
    const linkEl = document.getElementById("user-github-link");
    const countEl = document.getElementById("user-domain-count");
    const statusEl = document.getElementById("user-status");
    const domainsList = document.getElementById("user-domains-list");

    if (profile?.avatar_url) {
        avatarEl.src = profile.avatar_url;
        avatarEl.alt = `${username}'s avatar`;
        avatarEl.classList.remove("hidden");
    } else {
        avatarEl.classList.add("hidden");
    }

    nameEl.textContent = profile?.name || username;
    linkEl.href = `https://github.com/${encodeURIComponent(username)}`;
    linkEl.textContent = `@${username}`;
    countEl.textContent = formatNumber(domains.length);
    statusEl.textContent = domains.length ? "FOUND" : "NO DOMAINS";
    statusEl.classList.remove("text-emerald-400", "text-amber-400");
    statusEl.classList.add(domains.length ? "text-emerald-400" : "text-amber-400");

    if (domains.length) {
        domainsList.innerHTML = domains
            .sort((a, b) => a.subdomain.localeCompare(b.subdomain))
            .map((domain) => {
                const status = domain.reserved ? "RESERVED" : "REGISTERED";
                const statusClass = domain.reserved ? "text-amber-400" : "text-emerald-400";
                const records = domain.records || {};
                const recordTypes = Object.keys(records).sort();
                const recordsHtml = recordTypes
                    .map((type) => {
                        const value = formatUserDomainRecord(records[type]);
                        return `<span class="terminal-text text-gray-400 text-sm break-all">${escapeHtml(type)}: ${escapeHtml(value)}</span>`;
                    })
                    .join("");
                return `
          <li class="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="flex items-center gap-3 flex-wrap">
              <a href="#${encodeURIComponent(domain.subdomain)}" class="terminal-text font-semibold text-[var(--accent)] hover:underline">${escapeHtml(domain.subdomain)}</a>
              <span class="text-xs font-semibold ${statusClass}">${status}</span>
              ${domain.proxied ? '<span class="text-xs text-[var(--body-fg)]/60">Proxied</span>' : ""}
              ${domain.owner?.email ? `<span class="text-xs text-[var(--body-fg)]/60">${escapeHtml(domain.owner.email)}</span>` : ""}
            </div>
            <div class="flex flex-col gap-1 sm:text-right">${recordsHtml}</div>
          </li>
        `;
            })
            .join("");
    } else {
        domainsList.innerHTML = `
          <li class="px-6 py-4 text-[var(--body-fg)]/70">No is-a.dev subdomains found for this user.</li>
        `;
    }

    userResult.classList.remove("hidden");
    userResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function performUserQuery(rawQuery) {
    const userLoading = document.getElementById("user-loading");
    const userError = document.getElementById("user-error");
    const userResult = document.getElementById("user-result");

    const username = normalizeUsername(rawQuery);

    userError.classList.add("hidden");
    userResult.classList.add("hidden");

    if (!username) return;

    if (!isValidUsername(username)) {
        userError.textContent = `"${rawQuery.trim()}" is not a valid GitHub username.`;
        userError.classList.remove("hidden");
        return;
    }

    userLoading.classList.remove("hidden");

    try {
        const [profile, all] = await Promise.all([fetchUserProfile(username), loadFullData()]);

        const domains = all.filter(
            (domain) => domain.owner?.username?.toLowerCase() === username && !domain.reserved
        );

        if (!profile && !domains.length) {
            userError.textContent = `GitHub user "${username}" not found.`;
            userError.classList.remove("hidden");
            return;
        }

        renderUserResult(username, profile, domains);
    } catch (err) {
        userError.textContent = `Failed to process query: ${err.message}`;
        userError.classList.remove("hidden");
    } finally {
        userLoading.classList.add("hidden");
    }
}

/* ------------------------ Registry Statistics ------------------------ */

const chartTextColor = "#d1c4ff";
const chartGridColor = "rgba(209, 196, 255, 0.1)";
const accentColor = "#7041ff";

function renderCharts(recordCounts, topUsers) {
    if (typeof Chart === "undefined") return;

    Chart.defaults.color = chartTextColor;
    Chart.defaults.font.family = "Roboto, sans-serif";

    const recordTypesCanvas = document.getElementById("record-types-chart");
    if (recordTypesCanvas && recordCounts.length) {
        const labels = recordCounts.map(([type]) => type);
        const values = recordCounts.map(([, count]) => count);
        const colors = recordCounts.map((_, i) => {
            const hue = (i * 360) / recordCounts.length;
            return `hsl(${hue}, 80%, 60%)`;
        });

        new Chart(recordTypesCanvas, {
            type: "doughnut",
            data: {
                labels,
                datasets: [
                    {
                        data: values,
                        backgroundColor: colors,
                        borderColor: "transparent"
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "right" }
                }
            }
        });
    }

    const topUsersCanvas = document.getElementById("top-users-chart");
    if (topUsersCanvas && topUsers.length) {
        new Chart(topUsersCanvas, {
            type: "bar",
            data: {
                labels: topUsers.map(([username]) => username),
                datasets: [
                    {
                        label: "Subdomains",
                        data: topUsers.map(([, count]) => count),
                        backgroundColor: accentColor,
                        borderRadius: 6
                    }
                ]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Subdomain Count",
                            color: chartTextColor,
                            font: { weight: "bold" }
                        },
                        grid: { color: chartGridColor },
                        ticks: { precision: 0 }
                    },
                    y: {
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

async function fetchStats() {
    const loading = document.getElementById("loading");
    const error = document.getElementById("error");
    const content = document.getElementById("content");

    try {
        const json = await loadFullData();
        const data = json.filter((domain) => !domain.reserved);
        const subdomains = data.length;

        const usernames = data.map((domain) => domain.owner.username).filter(Boolean);
        const uniqueUsers = [...new Set(usernames)].length;
        const averageDomainsPerUser = uniqueUsers ? (subdomains / uniqueUsers).toFixed(1) : "0.0";
        const subdomainsWithWebsites = data.filter(
            (domain) => domain.records?.A || domain.records?.AAAA || domain.records?.CNAME
        ).length;
        const subdomainsWithWebsitesPercentage = subdomains
            ? ((subdomainsWithWebsites / subdomains) * 100).toFixed(1)
            : "0.0";
        const subdomainsWithUrl = data.filter((domain) => domain.records?.URL).length;
        const subdomainsWithUrlPercentage = subdomains ? ((subdomainsWithUrl / subdomains) * 100).toFixed(1) : "0.0";
        const subdomainsWithEmail = data.filter((domain) => domain.records?.MX).length;
        const subdomainsWithEmailPercentage = subdomains
            ? ((subdomainsWithEmail / subdomains) * 100).toFixed(1)
            : "0.0";
        const githubPagesCount = data.filter(
            (domain) =>
                domain.records?.A?.some((a) =>
                    ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"].includes(a)
                ) || domain.records?.CNAME?.endsWith("github.io")
        ).length;
        const githubPagesPercentage = subdomainsWithWebsites
            ? ((githubPagesCount / subdomainsWithWebsites) * 100).toFixed(1)
            : "0.0";
        const cloudflarePagesCount = data.filter((domain) => domain.records?.CNAME?.endsWith("pages.dev")).length;
        const cloudflarePagesPercentage = subdomainsWithWebsites
            ? ((cloudflarePagesCount / subdomainsWithWebsites) * 100).toFixed(1)
            : "0.0";
        const reservedCount = json.filter((domain) => domain.reserved).length;
        const proxiedCount = data.filter((domain) => domain.proxied).length;
        const proxiedPercentage = subdomains ? ((proxiedCount / subdomains) * 100).toFixed(1) : "0.0";

        const userCounts = {};
        for (const domain of data) {
            const username = domain.owner.username;
            if (!username) continue;
            userCounts[username] = (userCounts[username] || 0) + 1;
        }

        let recordCounts = {};
        let totalRecords = 0;

        for (const domain of data) {
            for (const [recordType, recordValue] of Object.entries(domain.records || {})) {
                if (!recordCounts[recordType]) recordCounts[recordType] = 0;
                if (Array.isArray(recordValue)) {
                    recordCounts[recordType] += recordValue.length;
                    totalRecords += recordValue.length;
                } else {
                    recordCounts[recordType]++;
                    totalRecords++;
                }
            }
        }

        recordCounts = Object.entries(recordCounts).sort((a, b) => b[1] - a[1]);

        const topUsers = Object.entries(userCounts)
            .filter(([username]) => username !== "is-a-dev")
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        renderCharts(recordCounts, topUsers);

        document.getElementById("subdomains").textContent = formatNumber(subdomains);
        document.getElementById("records").textContent = formatNumber(totalRecords);
        document.getElementById("unique-users").textContent = formatNumber(uniqueUsers);
        document.getElementById("average-domains-per-user").textContent = formatNumber(averageDomainsPerUser);
        document.getElementById("subdomains-with-websites").textContent =
            `${formatNumber(subdomainsWithWebsites)} (${subdomainsWithWebsitesPercentage}%)`;
        document.getElementById("subdomains-with-url").textContent =
            `${formatNumber(subdomainsWithUrl)} (${subdomainsWithUrlPercentage}%)`;
        document.getElementById("subdomains-with-email").textContent =
            `${formatNumber(subdomainsWithEmail)} (${subdomainsWithEmailPercentage}%)`;
        document.getElementById("github-pages").textContent = `${formatNumber(githubPagesCount)} (${githubPagesPercentage}%)`;
        document.getElementById("cloudflare-pages").textContent =
            `${formatNumber(cloudflarePagesCount)} (${cloudflarePagesPercentage}%)`;
        document.getElementById("reserved-subdomains").textContent = formatNumber(reservedCount);
        document.getElementById("proxied-subdomains").textContent = `${formatNumber(proxiedCount)} (${proxiedPercentage}%)`;

        const recordsList = document.getElementById("stats-records-list");

        recordsList.innerHTML = [...recordCounts]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(
                ([recordType, count]) => `
          <li class="flex items-center justify-between px-6 py-4">
            <span class="font-semibold">${escapeHtml(recordType)}</span>
            <span class="text-gray-500">${formatNumber(count)}</span>
          </li>
        `
            )
            .join("");

        loading.classList.add("hidden");
        content.classList.remove("hidden");

        // Fetch raw.is-a.dev/timestamp file for timestamp
        const rawApiResponse = await fetch(`${RAW_API_BASE}/timestamp`);
        if (rawApiResponse.ok) {
            const rawApiTimestamp = await rawApiResponse.text();
            const rawApiDate = new Date(parseInt(rawApiTimestamp, 10));
            const rawApiTextFormatted = rawApiDate.toLocaleString("en-AU", {
                dateStyle: "long",
                timeStyle: "medium"
            });
            document.getElementById("raw-api-updated").textContent = rawApiTextFormatted;
        }

        // Fetch _zone-updated.is-a.dev TXT DNS record
        const zoneUpdatedResponse = await fetch("https://cloudflare-dns.com/dns-query?name=_zone-updated.is-a.dev&type=TXT", {
            headers: { Accept: "application/dns-json" }
        });

        if (zoneUpdatedResponse.ok) {
            const zoneUpdatedData = await zoneUpdatedResponse.json();
            const zoneUpdatedText = zoneUpdatedData.Answer?.[0]?.data?.replace(/"/g, "") || "Unknown";
            const zoneUpdatedDate = new Date(parseInt(zoneUpdatedText, 10));
            const zoneUpdatedTextFormatted = zoneUpdatedDate.toLocaleString("en-AU", {
                dateStyle: "long",
                timeStyle: "medium"
            });
            document.getElementById("zone-updated").textContent = zoneUpdatedTextFormatted;
        }
    } catch (err) {
        loading.classList.add("hidden");
        error.textContent = `Failed to load data: ${err.message}`;
        error.classList.remove("hidden");
    }
}

/* ------------------------------ Wiring ------------------------------ */

const whoisForm = document.getElementById("whois-form");
const whoisInput = document.getElementById("whois-input");

whoisForm.addEventListener("submit", (event) => {
    event.preventDefault();
    performQuery(whoisInput.value);
});

const userForm = document.getElementById("user-form");
const userInput = document.getElementById("user-input");

userForm.addEventListener("submit", (event) => {
    event.preventDefault();
    performUserQuery(userInput.value);
});

document.querySelectorAll(".query-example").forEach((button) => {
    button.addEventListener("click", () => {
        whoisInput.value = button.textContent.trim();
        performQuery(whoisInput.value);
    });
});

document.getElementById("copy-whois").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
        await navigator.clipboard.writeText(document.getElementById("whois-output").textContent);
        button.textContent = "Copied";
        setTimeout(() => (button.textContent = "Copy"), 2000);
    } catch {
        button.textContent = "Failed";
        setTimeout(() => (button.textContent = "Copy"), 2000);
    }
});

window.addEventListener("hashchange", () => {
    const query = decodeURIComponent(location.hash.slice(1));
    if (query) {
        whoisInput.value = query;
        performQuery(query);
    }
});

if (location.hash.length > 1) {
    const query = decodeURIComponent(location.hash.slice(1));
    whoisInput.value = query;
    performQuery(query);
}

fetchStats();
