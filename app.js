const API_BASE = "https://www.dnd5eapi.co";

let activeEncounter = [];
let allMonsters = [];
let selectIdx = "";
const monsterDataByIndex = new Map();

const sInput = document.getElementById("monster-search");
const sugList = document.getElementById("suggestions-list");
const addBtn = document.getElementById("add-monster-btn");
const azList = document.getElementById("alphabetical-list");
const roster = document.getElementById("encounter-roster");
const totM = document.getElementById("total-monsters");
const totXp = document.getElementById("total-xp");
const rollLog = document.getElementById("roll-log");
const catalogStatus = document.getElementById("catalog-status");

const xpThresholds = {
    easy: [25, 50, 75, 125, 250, 300, 350, 450, 600, 800, 1000, 1200, 1600, 2000, 2200, 2500, 2800, 3200, 3900, 5700],
    medium: [50, 100, 150, 250, 500, 600, 750, 900, 1200, 1600, 2000, 2400, 3200, 4000, 4500, 5000, 5500, 5900, 7200, 8500],
    hard: [75, 150, 225, 375, 750, 900, 1100, 1400, 1600, 2400, 3000, 3600, 4800, 6000, 7000, 7500, 9000, 10000, 11000, 12700],
    deadly: [100, 200, 400, 500, 1100, 1400, 1700, 2100, 2400, 3600, 4500, 5400, 7200, 9000, 11000, 12000, 14000, 15000, 18000, 20000]
};

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function saveEncounter() {
    localStorage.setItem("dndEnc", JSON.stringify(activeEncounter));
}

function abilityModifier(score) {
    return Math.floor(((Number(score) || 10) - 10) / 2);
}

function rollInitiativeForMonster(dex) {
    return Math.floor(Math.random() * 20) + 1 + abilityModifier(dex);
}

function addRollLog(message) {
    if (!rollLog) return;

    const current = rollLog.textContent.trim() === "> Ready to roll..."
        ? ""
        : `${rollLog.innerHTML}<br>`;

    rollLog.innerHTML = current + message;
    rollLog.scrollTop = rollLog.scrollHeight;
}

window.rollDie = function (sides) {
    const quantity = Math.max(
        1,
        Math.min(100, parseInt(document.getElementById("dice-quantity")?.value, 10) || 1)
    );

    const rolls = Array.from(
        { length: quantity },
        () => Math.floor(Math.random() * sides) + 1
    );

    const total = rolls.reduce((sum, roll) => sum + roll, 0);

    addRollLog(
        `Rolled ${quantity === 1 ? `d${sides}` : `${quantity}d${sides}`}: ` +
        `${rolls.join(", ")} | Total: <strong>${total}</strong>`
    );
};

window.clearRolls = function () {
    if (rollLog) rollLog.innerHTML = "> Ready to roll...";
};

window.rerollInitiative = function (id) {
    const monster = activeEncounter.find((item) => item.id === id);
    if (!monster) return;

    const d20 = Math.floor(Math.random() * 20) + 1;
    const modifier = abilityModifier(monster.dex);
    monster.initiative = d20 + modifier;

    addRollLog(
        `<strong>${escapeHtml(monster.name)}</strong> Initiative: ` +
        `d20(${d20})${modifier >= 0 ? "+" : ""}${modifier} = ` +
        `<strong>${monster.initiative}</strong>`
    );

    activeEncounter.sort((a, b) => b.initiative - a.initiative);
    saveEncounter();
    updateUI(id);
};

window.rollMonsterAttack = function (id) {
    const monster = activeEncounter.find((item) => item.id === id);
    if (!monster) return;

    const modifier = abilityModifier(monster.str);
    const d20 = Math.floor(Math.random() * 20) + 1;

    addRollLog(
        `<strong>${escapeHtml(monster.name)}</strong> Strength attack: ` +
        `d20(${d20})${modifier >= 0 ? "+" : ""}${modifier} = ` +
        `<strong>${d20 + modifier} to hit</strong>. Check the listed action for damage.`
    );
};

window.rollCheckOrSave = function (id, selectId) {
    const monster = activeEncounter.find((item) => item.id === id);
    const select = document.getElementById(selectId);
    if (!monster || !select) return;

    const [ability, rollType] = select.value.split("-");
    const modifier = abilityModifier(monster[ability]);
    const d20 = Math.floor(Math.random() * 20) + 1;

    addRollLog(
        `<strong>${escapeHtml(monster.name)}</strong> ` +
        `${ability.toUpperCase()} ${rollType === "save" ? "Save" : "Check"}: ` +
        `d20(${d20})${modifier >= 0 ? "+" : ""}${modifier} = ` +
        `<strong>${d20 + modifier}</strong>`
    );
};

function normalizeMonster(data, fallbackIndex = "") {
    const abilities = {};

    for (const ability of data.ability_scores || []) {
        abilities[ability.name] = Number(ability.value);
    }

    const hp = Number(data.hit_points);
    if (!Number.isFinite(hp) || hp <= 0) {
        throw new Error(`API returned invalid HP for ${data.name || fallbackIndex}`);
    }

    const acEntry = Array.isArray(data.armor_class)
        ? data.armor_class[0]
        : null;

    const ac = Number(acEntry?.value ?? data.armor_class);

    return {
        index: data.index || fallbackIndex,
        name: data.name || fallbackIndex || "Unknown monster",
        cr: data.challenge_rating == null || data.challenge_rating === ""
            ? "Unknown"
            : String(data.challenge_rating),
        xp: Number.isFinite(Number(data.xp)) ? Number(data.xp) : 0,
        maxHp: hp,
        currentHp: hp,
        ac: Number.isFinite(ac) ? ac : 10,
        str: abilities.STR ?? 10,
        dex: abilities.DEX ?? 10,
        con: abilities.CON ?? 10,
        int: abilities.INT ?? 10,
        wis: abilities.WIS ?? 10,
        cha: abilities.CHA ?? 10,
        actions: (data.actions || [])
            .map((action) => `${action.name}: ${action.desc || ""}`)
            .join("\n\n") || "No action details available.",
        custom: false
    };
}

async function fetchMonster(index) {
    if (monsterDataByIndex.has(index)) {
        return monsterDataByIndex.get(index);
    }

    const response = await fetch(
        `${API_BASE}/api/2014/monsters/${encodeURIComponent(index)}`
    );

    if (!response.ok) {
        throw new Error(`Monster request failed (${response.status})`);
    }

    const monster = normalizeMonster(await response.json(), index);
    monsterDataByIndex.set(index, monster);
    return monster;
}

/*
 * Loads every monster name from the API, then fetches its details in batches.
 * monsters.txt is no longer used.
 */
async function loadMonsterFile() {
    try {
        if (catalogStatus) {
            catalogStatus.textContent = "Loading monsters from the API...";
        }

        const response = await fetch(`${API_BASE}/api/2014/monsters`);
        if (!response.ok) {
            throw new Error(`Monster list request failed (${response.status})`);
        }

        const data = await response.json();

        allMonsters = (data.results || [])
            .map((monster) => ({
                name: monster.name,
                index: monster.index,
                url: monster.url,
                xp: null
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        if (!allMonsters.length) {
            throw new Error("The API returned an empty monster catalog.");
        }

        sInput.disabled = false;
        sInput.placeholder = "Search monster catalog...";
        renderAZ();

        let loaded = 0;
        const batchSize = 8;

        for (let start = 0; start < allMonsters.length; start += batchSize) {
            const batch = allMonsters.slice(start, start + batchSize);

            const results = await Promise.allSettled(
                batch.map(async (entry) => {
                    const monsterResponse = await fetch(`${API_BASE}${entry.url}`);

                    if (!monsterResponse.ok) {
                        throw new Error(`Could not load ${entry.name}`);
                    }

                    return normalizeMonster(
                        await monsterResponse.json(),
                        entry.index
                    );
                })
            );

            results.forEach((result, position) => {
                if (result.status !== "fulfilled") {
                    console.warn(
                        `Could not load ${batch[position].name}:`,
                        result.reason
                    );
                    return;
                }

                const monster = result.value;
                const entry = batch[position];

                entry.name = monster.name;
                entry.index = monster.index;
                entry.xp = monster.xp;

                monsterDataByIndex.set(monster.index, monster);
                loaded++;
            });

            if (catalogStatus) {
                catalogStatus.textContent =
                    `Loaded stats for ${loaded} of ${allMonsters.length} monsters...`;
            }

            renderAZ();
        }

        if (catalogStatus) {
            catalogStatus.textContent =
                `Loaded ${loaded} of ${allMonsters.length} monsters from the API.`;
        }

        renderAZ();
    } catch (error) {
        console.error("Catalog load failed:", error);

        if (catalogStatus) {
            catalogStatus.textContent =
                "Could not load monster data. Check your internet connection and browser console.";
        }
    }
}

function normalizeSavedMonster(monster) {
    const maxHp = Number(monster.maxHp ?? monster.hp);
    const safeMaxHp = Number.isFinite(maxHp) && maxHp > 0 ? maxHp : 1;
    const currentHp = Number(monster.currentHp);

    return {
        ...monster,
        maxHp: safeMaxHp,
        currentHp: Number.isFinite(currentHp)
            ? Math.max(0, Math.min(safeMaxHp, currentHp))
            : safeMaxHp,
        cr: monster.cr == null || monster.cr === ""
            ? (monster.custom ? "Custom" : "Unknown")
            : String(monster.cr),
        xp: Number.isFinite(Number(monster.xp)) ? Number(monster.xp) : 0,
        ac: Number.isFinite(Number(monster.ac)) ? Number(monster.ac) : 10,
        str: Number(monster.str) || 10,
        dex: Number(monster.dex) || 10,
        con: Number(monster.con) || 10,
        int: Number(monster.int) || 10,
        wis: Number(monster.wis) || 10,
        cha: Number(monster.cha) || 10,
        actions: monster.actions || "No action details available.",
        initiative: Number(monster.initiative) || 0
    };
}

async function refreshSavedMonster(monster) {
    if (monster.custom || !monster.index) {
        return normalizeSavedMonster(monster);
    }

    try {
        const fresh = await fetchMonster(monster.index);

        return {
            ...fresh,
            id: monster.id ||
                `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            currentHp: Math.max(
                0,
                Math.min(fresh.maxHp, Number(monster.currentHp) || fresh.maxHp)
            ),
            initiative: Number(monster.initiative) || 0
        };
    } catch (error) {
        console.warn(`Could not refresh ${monster.name}:`, error);
        return normalizeSavedMonster(monster);
    }
}

window.addEventListener("DOMContentLoaded", async () => {
    try {
        const saved = JSON.parse(localStorage.getItem("dndEnc") || "[]");
        activeEncounter = Array.isArray(saved)
            ? saved.map(normalizeSavedMonster)
            : [];
    } catch {
        activeEncounter = [];
    }

    updateUI();
    await loadMonsterFile();

    if (activeEncounter.length) {
        activeEncounter = await Promise.all(
            activeEncounter.map(refreshSavedMonster)
        );
        saveEncounter();
        updateUI();
    }

    sInput.addEventListener("input", handleType);

    document.getElementById("random-fight-btn")
        ?.addEventListener("click", generateRandomFight);

    document.getElementById("sort-initiative-btn")
        ?.addEventListener("click", () => {
            activeEncounter.sort((a, b) => b.initiative - a.initiative);
            saveEncounter();
            updateUI();
        });

    document.getElementById("clear-encounter-btn")
        ?.addEventListener("click", () => {
            if (confirm("Completely wipe the current encounter roster?")) {
                activeEncounter = [];
                saveEncounter();
                updateUI();
            }
        });

    addBtn.addEventListener("click", async () => {
        if (!selectIdx) return;

        const index = selectIdx;
        addBtn.disabled = true;
        await addCatalogUnit(index);
        sInput.value = "";
        selectIdx = "";
    });

    document.getElementById("add-homebrew-btn")
        ?.addEventListener("click", () => {
            const name = document.getElementById("hb-name").value.trim();
            const hp = Math.max(
                1,
                parseInt(document.getElementById("hb-hp").value, 10) || 15
            );
            const ac = Math.max(
                1,
                parseInt(document.getElementById("hb-ac").value, 10) || 10
            );
            const actions =
                document.getElementById("hb-actions").value.trim() || "Strike.";

            if (!name) {
                alert("Enter a creature name.");
                return;
            }

            addHomebrewUnit(name, { hp, ac, actions });

            document.getElementById("hb-name").value = "";
            document.getElementById("hb-hp").value = "";
            document.getElementById("hb-ac").value = "";
            document.getElementById("hb-actions").value = "";
        });

    document.addEventListener("click", (event) => {
        if (event.target !== sInput && !sugList.contains(event.target)) {
            sugList.style.display = "none";
        }
    });
});

async function addCatalogUnit(index) {
    try {
        const monster = await fetchMonster(index);
        addUnit(monster);
    } catch (error) {
        console.error(`Could not add ${index}:`, error);
        alert(
            "Could not load this monster's stats. It was not added. " +
            "Check the browser console for details."
        );
    } finally {
        addBtn.disabled = !selectIdx;
    }
}

function addUnit(data) {
    const maxHp = Number(data.maxHp);

    if (!Number.isFinite(maxHp) || maxHp <= 0) {
        alert("The API did not provide valid HP, so this monster was not added.");
        return;
    }

    const monster = {
        ...data,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        maxHp,
        currentHp: maxHp,
        cr: data.cr == null || data.cr === "" ? "Unknown" : String(data.cr),
        initiative: rollInitiativeForMonster(data.dex)
    };

    activeEncounter.push(monster);
    activeEncounter.sort((a, b) => b.initiative - a.initiative);
    saveEncounter();
    updateUI();
}

function addHomebrewUnit(name, values) {
    addUnit({
        name,
        index: "",
        cr: "Custom",
        xp: 0,
        maxHp: values.hp,
        currentHp: values.hp,
        ac: values.ac,
        str: 10,
        dex: 10,
        con: 10,
        int: 10,
        wis: 10,
        cha: 10,
        actions: values.actions,
        custom: true
    });
}

window.updateStatScore = function (id, statName, value) {
    const monster = activeEncounter.find((item) => item.id === id);
    if (!monster) return;

    monster[statName] = parseInt(value, 10) || 10;
    saveEncounter();
};

window.updateInitiativeValue = function (id, value) {
    const monster = activeEncounter.find((item) => item.id === id);
    if (!monster) return;

    monster.initiative = parseInt(value, 10) || 0;
    saveEncounter();
    updateUI(id);
};

window.changeHp = function (id, amount) {
    const monster = activeEncounter.find((item) => item.id === id);
    if (!monster) return;

    monster.currentHp = Math.max(
        0,
        Math.min(monster.maxHp, monster.currentHp + amount)
    );

    saveEncounter();
    updateUI();
};

window.removeMonster = function (id) {
    activeEncounter = activeEncounter.filter((item) => item.id !== id);
    saveEncounter();
    updateUI();
};

window.toggleDetails = function (id) {
    const element = document.getElementById(`details-${id}`);
    if (element) {
        element.style.display =
            element.style.display === "block" ? "none" : "block";
    }
};

function handleType() {
    const query = sInput.value.toLowerCase().trim();
    sugList.innerHTML = "";
    selectIdx = "";
    addBtn.disabled = true;

    if (!query) {
        sugList.style.display = "none";
        return;
    }

    const matches = allMonsters
        .filter((monster) => monster.name.toLowerCase().includes(query))
        .slice(0, 8);

    if (!matches.length) {
        sugList.innerHTML =
            '<li style="padding:10px;color:#aaa;">No matches</li>';
        sugList.style.display = "block";
        return;
    }

    matches.forEach((monster) => {
        const li = document.createElement("li");
        li.textContent = monster.name;

        li.addEventListener("click", () => {
            sInput.value = monster.name;
            selectIdx = monster.index;
            sugList.style.display = "none";
            addBtn.disabled = false;
        });

        sugList.appendChild(li);
    });

    sugList.style.display = "block";
}

function renderAZ() {
    if (!azList) return;

    azList.innerHTML = "";

    allMonsters.forEach((monster) => {
        const row = document.createElement("div");
        row.className = "az-item";

        const name = document.createElement("span");
        name.textContent = monster.name;

        const badge = document.createElement("span");
        badge.className = "summon-badge";
        badge.textContent = Number.isFinite(monster.xp)
            ? `${monster.xp} XP`
            : "+ Add";

        row.append(name, badge);
        row.addEventListener("click", () => addCatalogUnit(monster.index));
        azList.appendChild(row);
    });
}

function getMonsterCountMultiplier(count) {
    if (count === 1) return 1;
    if (count === 2) return 1.5;
    if (count <= 6) return 2;
    if (count <= 10) return 2.5;
    if (count <= 14) return 3;
    return 4;
}

function generateRandomFight() {
    const level = Math.max(
        1,
        Math.min(
            20,
            parseInt(document.getElementById("party-level").value, 10) || 1
        )
    );

    const partySize = Math.max(
        1,
        Math.min(
            12,
            parseInt(document.getElementById("party-size").value, 10) || 1
        )
    );

    const enemyCount = Math.max(
        1,
        Math.min(
            100,
            parseInt(document.getElementById("enemy-count").value, 10) || 1
        )
    );

    const requestedDifficulty =
        document.getElementById("fight-difficulty")?.value || "medium";
    const result = document.getElementById("fight-result");

    const available = allMonsters
        .map((entry) => monsterDataByIndex.get(entry.index))
        .filter((monster) => monster && monster.xp > 0);

    if (!available.length) {
        result.textContent = "Monster stats have not loaded yet.";
        return;
    }

    const multiplier = getMonsterCountMultiplier(enemyCount);
    const targetAdjustedXp =
        xpThresholds[requestedDifficulty][level - 1] * partySize;
    const targetBaseXp = targetAdjustedXp / multiplier;

    let bestGroup = null;
    let bestDifference = Infinity;

    for (let attempt = 0; attempt < 1500; attempt++) {
        const group = [];
        let baseXp = 0;

        for (let i = 0; i < enemyCount; i++) {
            const remaining = enemyCount - i;
            const desiredXp = Math.max(
                1,
                (targetBaseXp - baseXp) / remaining
            );

            const candidates = available
                .map((monster) => ({
                    monster,
                    difference: Math.abs(monster.xp - desiredXp)
                }))
                .sort((a, b) => a.difference - b.difference)
                .slice(0, Math.min(10, available.length));

            const selected =
                candidates[Math.floor(Math.random() * candidates.length)].monster;

            group.push(selected);
            baseXp += selected.xp;
        }

        const adjustedXp = baseXp * multiplier;
        const difference = Math.abs(adjustedXp - targetAdjustedXp);

        if (difference < bestDifference) {
            bestDifference = difference;
            bestGroup = group;
        }

        if (bestDifference === 0) break;
    }

    if (!bestGroup) {
        result.textContent = "Could not build an encounter from the loaded monsters.";
        return;
    }

    bestGroup.forEach(addUnit);

    const baseXp = bestGroup.reduce((sum, monster) => sum + monster.xp, 0);
    const adjustedXp = Math.round(baseXp * multiplier);

    const partyThresholds = Object.fromEntries(
        Object.entries(xpThresholds).map(([tier, values]) => [
            tier,
            values[level - 1] * partySize
        ])
    );

    let estimatedDifficulty = "Below Easy";

    if (adjustedXp >= partyThresholds.deadly) {
        estimatedDifficulty = "Deadly";
    } else if (adjustedXp >= partyThresholds.hard) {
        estimatedDifficulty = "Hard";
    } else if (adjustedXp >= partyThresholds.medium) {
        estimatedDifficulty = "Medium";
    } else if (adjustedXp >= partyThresholds.easy) {
        estimatedDifficulty = "Easy";
    }

    const titleCase = (text) =>
        text.charAt(0).toUpperCase() + text.slice(1);

    result.textContent =
        `Generated ${enemyCount} enemies for ${partySize} level-${level} player(s). ` +
        `Target: ${titleCase(requestedDifficulty)}. ` +
        `Estimated difficulty: ${estimatedDifficulty} ` +
        `(${adjustedXp.toLocaleString()} adjusted XP).`;
}

function renderStatHtml(monster, statName) {
    const value = Number(monster[statName]) || 10;

    if (monster.custom) {
        return `<input type="number" value="${value}"
            oninput="updateStatScore('${monster.id}', '${statName}', this.value)"
            onclick="event.stopPropagation();">`;
    }

    return `<strong>${value}</strong>`;
}

function updateUI(openDetailsId = null) {
    if (totM) totM.textContent = activeEncounter.length;

    const totalXp = activeEncounter.reduce(
        (sum, monster) => sum + (Number(monster.xp) || 0),
        0
    );

    if (totXp) totXp.textContent = `${totalXp.toLocaleString()} XP`;
    if (!roster) return;

    if (!activeEncounter.length) {
        roster.innerHTML =
            '<p style="text-align:center;color:#888;">No combatants added.</p>';
        return;
    }

    roster.innerHTML = "";

    activeEncounter.forEach((monster) => {
        const maxHp = Number(monster.maxHp) || 1;
        const currentHp = Number.isFinite(Number(monster.currentHp))
            ? Number(monster.currentHp)
            : maxHp;

        const cr = monster.cr == null || monster.cr === ""
            ? "Unknown"
            : String(monster.cr);

        const badge = monster.initiative > 0
            ? `<span class="init-badge">Init: ${monster.initiative}</span>`
            : "";

        const div = document.createElement("div");
        div.className =
            "monster-card" + (monster.initiative > 0 ? " has-init" : "");

        div.innerHTML = `
            <div class="card-main" onclick="toggleDetails('${monster.id}')">
                <div class="monster-info">
                    <h4>${escapeHtml(monster.name)} ${badge}</h4>
                    <p>CR: <strong>${escapeHtml(cr)}</strong> | AC: <strong>${Number(monster.ac) || 10}</strong></p>
                </div>
                <div class="hp-tracker" onclick="event.stopPropagation();">
                    <button class="hp-btn" onclick="changeHp('${monster.id}', -1)">-1</button>
                    <div class="hp-display">${currentHp} / ${maxHp} HP</div>
                    <button class="hp-btn" onclick="changeHp('${monster.id}', 1)">+1</button>
                </div>
            </div>

            <div id="details-${monster.id}" class="card-details">
                <div class="init-row" onclick="event.stopPropagation();">
                    <label style="margin:0;font-size:0.9rem;">Set Initiative:</label>
                    <input type="number" value="${Number(monster.initiative) || 0}"
                        oninput="updateInitiativeValue('${monster.id}', this.value)">
                </div>

                <button class="roll-initiative-btn"
                    onclick="event.stopPropagation(); rerollInitiative('${monster.id}')">
                    Roll Initiative
                </button>

                <div class="stat-grid">
                    <div class="stat-block"><div>STR</div>${renderStatHtml(monster, "str")}</div>
                    <div class="stat-block"><div>DEX</div>${renderStatHtml(monster, "dex")}</div>
                    <div class="stat-block"><div>CON</div>${renderStatHtml(monster, "con")}</div>
                    <div class="stat-block"><div>INT</div>${renderStatHtml(monster, "int")}</div>
                    <div class="stat-block"><div>WIS</div>${renderStatHtml(monster, "wis")}</div>
                    <div class="stat-block"><div>CHA</div>${renderStatHtml(monster, "cha")}</div>
                </div>

                <div class="attack-section">
                    <h5>Actions</h5>
                    <p>${escapeHtml(monster.actions || "No action details available.").replace(/\n/g, "<br>")}</p>

                    <button class="roll-attack-btn"
                        onclick="event.stopPropagation(); rollMonsterAttack('${monster.id}')">
                        Roll Strength Attack
                    </button>

                    <div class="roller-box" onclick="event.stopPropagation();">
                        <select id="roll-select-${monster.id}">
                            <option value="str-check">STR Check</option>
                            <option value="dex-check">DEX Check</option>
                            <option value="con-check">CON Check</option>
                            <option value="int-check">INT Check</option>
                            <option value="wis-check">WIS Check</option>
                            <option value="cha-check">CHA Check</option>
                            <option value="str-save">STR Save</option>
                            <option value="dex-save">DEX Save</option>
                            <option value="con-save">CON Save</option>
                            <option value="int-save">INT Save</option>
                            <option value="wis-save">WIS Save</option>
                            <option value="cha-save">CHA Save</option>
                        </select>
                        <button onclick="rollCheckOrSave('${monster.id}', 'roll-select-${monster.id}')">Roll</button>
                    </div>
                </div>

                <button class="remove-btn"
                    onclick="event.stopPropagation(); removeMonster('${monster.id}')">
                    Remove From Combat
                </button>
            </div>
        `;

        roster.appendChild(div);

        if (monster.id === openDetailsId) {
            document.getElementById(`details-${monster.id}`).style.display = "block";
        }
    });
}