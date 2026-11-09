import { COMBO_DISPLAY_NAMES } from './ComboManager.js';
import { formatCompact } from './FormatManager.js';

const FONT = 'Orbitron, Arial';
const BIG_UPGRADE_PAGE_SIZE = 60;

function makeTextButton(text, width, height) {
  text.setInteractive(
    new Phaser.Geom.Rectangle(0, 0, width, height),
    Phaser.Geom.Rectangle.Contains
  );
  if (text.input) text.input.cursor = 'pointer';
  return text;
}

/**
 * Local-game-style upgrade panels for OnlineGameScene.
 *
 * The local scene uses two slide-out tools (combo upgrades on the left and
 * big upgrades beside it) rather than a full-screen shop. Online renders the
 * same geometry from the server-authoritative `currentShop` snapshot.
 */
export default class OnlineShopUI {
  constructor(scene) {
    this.scene = scene;
  }

  get shop() {
    return this.scene.currentShop;
  }

  get score() {
    return Number(this.scene.scores?.[this.scene.localPlayerIndex] ?? 0);
  }

  ensure() {
    const s = this.scene;
    if (!this.shop) {
      this.close();
      return;
    }

    const combos = Array.isArray(this.shop.combos) ? this.shop.combos : [];
    const comboSignature = combos.map((combo) => combo.key).join('|');
    if (comboSignature !== s._comboSignature) {
      s._comboSignature = comboSignature;
      this.createComboToolbar();
    }

    const bigItems = Array.isArray(this.shop.big) ? this.shop.big : [];
    const bigSignature = bigItems.map((item) => item.key).join('|');
    if (bigSignature !== s._bigSignature) {
      s._bigSignature = bigSignature;
      s.bigUpgradePage = 0;
      this.createBigUpgradesPanelToolbar();
    }
  }

  refresh() {
    this.refreshComboToolbar();
    this.refreshBigUpgradesPanel();
  }

  createComboToolbar() {
    const s = this.scene;
    if (s.comboToolbarContainer) {
      try { s.comboToolbarContainer.destroy(true); } catch (err) { /* ignore */ }
      s.comboToolbarContainer = null;
    }
    s.comboToolbar = [];

    const combos = Array.isArray(this.shop?.combos) ? this.shop.combos : [];
    if (!combos.length) {
      if (s.comboToggleBtn) {
        try { s.comboToggleBtn.destroy(); } catch (err) { /* ignore */ }
        s.comboToggleBtn = null;
      }
      return;
    }

    const leftPad = Math.max(16, Math.floor(s.scale.width * 0.02));
    const panelWidth = 260;
    const hiddenX = leftPad - panelWidth - 20;
    const startY = 120;

    s.comboToolbarContainer = s.add.container(leftPad, 0).setDepth(1002);
    s.comboToolbarContainer.x = s.comboPanelOpen ? leftPad : hiddenX;
    s.comboToolbarContainer.setVisible(s.comboPanelOpen);

    combos.forEach((combo, index) => {
      const y = startY + index * 56;
      const rowBg = s.add.rectangle(0, y, panelWidth, 48, 0x0b0b0b, 0.92).setOrigin(0, 0.5);
      rowBg.setStrokeStyle(1, 0x222222);
      const label = s.add.text(12, y - 10, COMBO_DISPLAY_NAMES[combo.key] || combo.key.toUpperCase(), {
        fontSize: 16,
        fontFamily: FONT,
        color: '#ffffff'
      }).setOrigin(0, 0);
      const lvlText = s.add.text(12, y + 12, 'Lv 0', {
        fontSize: 14,
        fontFamily: FONT,
        color: '#ffff88'
      }).setOrigin(0, 0);
      const btn = s.add.text(panelWidth - 96, y - 8, 'UPGRADE', {
        fontSize: 14,
        fontFamily: FONT,
        color: '#66ff66'
      }).setOrigin(0, 0);
      btn.on('pointerdown', () => s.buyUpgrade('combo', combo.key));

      s.comboToolbarContainer.add([rowBg, label, lvlText, btn]);
      s.comboToolbar.push({ key: combo.key, ui: { rowBg, label, lvlText, btn } });
    });

    if (s.comboToggleBtn) {
      try { s.comboToggleBtn.destroy(); } catch (err) { /* ignore */ }
    }
    s.comboToggleBtn = s.add.text(leftPad - 16, startY - 24, s.comboPanelOpen ? '<' : '>', {
      fontSize: 20,
      fontFamily: FONT,
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(1003);
    makeTextButton(s.comboToggleBtn, 32, 40);
    s.comboToggleBtn.on('pointerdown', () => this.toggleComboToolbar());

    this.refreshComboToolbar();
  }

  refreshComboToolbar() {
    const s = this.scene;
    if (!s.comboToolbar?.length) return;
    const byKey = new Map((Array.isArray(this.shop?.combos) ? this.shop.combos : [])
      .map((combo) => [combo.key, combo]));
    const score = this.score;

    s.comboToolbar.forEach((entry) => {
      const combo = byKey.get(entry.key);
      if (!combo) return;
      const cost = Number(combo.cost || 0);
      const level = Number(combo.level || 0);
      const available = combo.available !== false;
      entry.ui.lvlText.setText(`Lv ${level}${available ? '' : ' (locked)'}`);
      entry.ui.btn.setText(cost ? `UPGRADE (${formatCompact(cost)})` : 'UPGRADE');

      const allowed = s.canUseShop() && available && score >= cost;
      if (allowed) {
        makeTextButton(entry.ui.btn, 126, 28);
        entry.ui.btn.setStyle({ color: '#66ff66' });
      } else {
        entry.ui.btn.disableInteractive();
        entry.ui.btn.setStyle({ color: '#555555' });
      }
    });
  }

  toggleComboToolbar() {
    const s = this.scene;
    if (!s.comboToolbarContainer) return;
    s.comboPanelOpen = !s.comboPanelOpen;
    s.shopOpen = s.comboPanelOpen || s.bigUpgradesOpen;

    const leftPad = Math.max(16, Math.floor(s.scale.width * 0.02));
    const panelWidth = 260;
    const hiddenX = leftPad - panelWidth - 20;
    s.comboToolbarContainer.setVisible(true);
    try { s.tweens.killTweensOf(s.comboToolbarContainer); } catch (err) { /* ignore */ }
    try {
      s.tweens.add({
        targets: s.comboToolbarContainer,
        x: s.comboPanelOpen ? leftPad : hiddenX,
        duration: 260,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          if (!s.comboPanelOpen && s.comboToolbarContainer) {
            s.comboToolbarContainer.setVisible(false);
          }
        }
      });
    } catch (err) { /* ignore */ }
    s.comboToggleBtn?.setText(s.comboPanelOpen ? '<' : '>');
    if (s.comboPanelOpen) this.refreshComboToolbar();
  }

  closeComboToolbarInstant() {
    const s = this.scene;
    if (s.comboToolbarContainer) {
      const leftPad = Math.max(16, Math.floor(s.scale.width * 0.02));
      const panelWidth = 260;
      try { s.comboToolbarContainer.x = leftPad - panelWidth - 20; } catch (err) { /* ignore */ }
      try { s.comboToolbarContainer.setVisible(false); } catch (err) { /* ignore */ }
    }
    s.comboToggleBtn?.setText('>');
    s.comboPanelOpen = false;
    s.shopOpen = s.bigUpgradesOpen;
  }

  createBigUpgradesPanelToolbar() {
    const s = this.scene;
    if (s.bigUpgradesToolbarContainer) {
      try { s.bigUpgradesToolbarContainer.destroy(true); } catch (err) { /* ignore */ }
      s.bigUpgradesToolbarContainer = null;
    }
    s.bigUpgradesToolbar = [];

    const items = Array.isArray(this.shop?.big) ? this.shop.big : [];
    s.bigUpgradePageCount = Math.max(1, Math.ceil(items.length / BIG_UPGRADE_PAGE_SIZE));
    s.bigUpgradePage = Math.max(0, Math.min(s.bigUpgradePage || 0, s.bigUpgradePageCount - 1));

    if (s.bigToggleBtn) { try { s.bigToggleBtn.destroy(); } catch (err) { /* ignore */ } s.bigToggleBtn = null; }
    if (s.bigPagePrevBtn) { try { s.bigPagePrevBtn.destroy(); } catch (err) { /* ignore */ } s.bigPagePrevBtn = null; }
    if (s.bigPageNextBtn) { try { s.bigPageNextBtn.destroy(); } catch (err) { /* ignore */ } s.bigPageNextBtn = null; }
    if (s.bigPageText) { try { s.bigPageText.destroy(); } catch (err) { /* ignore */ } s.bigPageText = null; }

    if (!items.length) {
      s.bigUpgradesOpen = false;
      s.shopOpen = s.comboPanelOpen;
      return;
    }

    const leftPad = Math.max(16, Math.floor(s.scale.width * 0.02));
    const startY = 120;
    const baseStartX = leftPad + 260 + 12;
    const upgradesPerColumn = 12;
    const maxColumns = 5;
    const columnGap = 14;
    const rowHeight = 64;
    const pageStart = s.bigUpgradePage * BIG_UPGRADE_PAGE_SIZE;
    const itemsToShow = items.slice(pageStart, pageStart + BIG_UPGRADE_PAGE_SIZE);
    const columns = Math.max(1, Math.min(maxColumns, Math.ceil(itemsToShow.length / upgradesPerColumn)));
    const totalGap = columnGap * Math.max(0, columns - 1);
    const availableWidth = Math.max(240, s.scale.width - baseStartX - 20);
    let panelWidth = Math.floor((availableWidth - totalGap) / columns);
    panelWidth = Math.max(180, Math.min(320, panelWidth));
    const totalWidth = panelWidth * columns + totalGap;
    let startX = baseStartX;
    if (startX + totalWidth > s.scale.width - 10) {
      startX = Math.max(leftPad, s.scale.width - totalWidth - 10);
    }

    s.bigUpgradesToolbarOpenX = startX;
    s.bigUpgradesToolbarClosedX = startX - 40;
    s.bigUpgradesToolbarContainer = s.add.container(startX, 0).setDepth(1002);
    s.bigUpgradesToolbarContainer.x = s.bigUpgradesOpen
      ? s.bigUpgradesToolbarOpenX
      : s.bigUpgradesToolbarClosedX;
    s.bigUpgradesToolbarContainer.setVisible(s.bigUpgradesOpen);

    itemsToShow.forEach((item, index) => {
      const col = Math.floor(index / upgradesPerColumn);
      const row = index % upgradesPerColumn;
      const x = col * (panelWidth + columnGap);
      const y = startY + row * rowHeight;
      const cost = Number(item.cost || 0);
      const rowBg = s.add.rectangle(x, y, panelWidth, 56, 0x0b0b0b, 0.92).setOrigin(0, 0.5);
      rowBg.setStrokeStyle(1, 0x222222);
      const title = s.add.text(x + 8, y - 12, item.title || item.key, {
        fontSize: 14,
        fontFamily: FONT,
        color: '#ffffff'
      }).setOrigin(0, 0);
      const desc = s.add.text(x + 8, y + 6, s.bigUpgradeDescription(item), {
        fontSize: 11,
        fontFamily: FONT,
        color: '#cccccc',
        wordWrap: { width: panelWidth - 120 }
      }).setOrigin(0, 0);
      const buyBtn = s.add.text(x + panelWidth - 96, y - 8, `BUY ${formatCompact(cost)}`, {
        fontSize: 14,
        fontFamily: FONT,
        color: '#66ff66'
      }).setOrigin(0, 0);
      buyBtn.on('pointerdown', () => s.buyUpgrade('big', item.key));

      s.bigUpgradesToolbarContainer.add([rowBg, title, desc, buyBtn]);
      s.bigUpgradesToolbar.push({ key: item.key, item, cost, title, desc, buyBtn, rowBg });
    });

    s.bigToggleBtn = s.add.text(startX - 18, startY - 24, s.bigUpgradesOpen ? '<' : '>', {
      fontSize: 20,
      fontFamily: FONT,
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(1003);
    makeTextButton(s.bigToggleBtn, 32, 40);
    s.bigToggleBtn.on('pointerdown', () => this.toggleBigUpgrades());

    if (s.bigUpgradePageCount > 1) {
      s.bigPageText = s.add.text(startX + 66, startY - 24, `Page ${s.bigUpgradePage + 1}/${s.bigUpgradePageCount}`, {
        fontSize: 12,
        fontFamily: FONT,
        color: '#cccccc'
      }).setDepth(1003).setVisible(s.bigUpgradesOpen);
      // The local scene only creates a page arrow when that direction is
      // available. Keep the same behaviour instead of showing dead arrows.
      if (s.bigUpgradePage > 0) {
        s.bigPagePrevBtn = s.add.text(startX - 22, s.scale.height * 0.5, '◀', {
          fontSize: 28,
          fontFamily: FONT,
          color: '#ffffff'
        }).setOrigin(0.5).setDepth(1003).setVisible(s.bigUpgradesOpen);
        makeTextButton(s.bigPagePrevBtn, 40, 40);
        s.bigPagePrevBtn.on('pointerdown', () => this.goToPreviousBigUpgradePage());
      }
      if (s.bigUpgradePage < s.bigUpgradePageCount - 1) {
        s.bigPageNextBtn = s.add.text(s.scale.width - 24, s.scale.height * 0.5, '▶', {
          fontSize: 28,
          fontFamily: FONT,
          color: '#ffffff'
        }).setOrigin(0.5).setDepth(1003).setVisible(s.bigUpgradesOpen);
        makeTextButton(s.bigPageNextBtn, 40, 40);
        s.bigPageNextBtn.on('pointerdown', () => this.goToNextBigUpgradePage());
      }
    }

    this.refreshBigUpgradesPanel();
  }

  refreshBigUpgradesPanel() {
    const s = this.scene;
    if (!s.bigUpgradesToolbar?.length) return;
    const byKey = new Map((Array.isArray(this.shop?.big) ? this.shop.big : [])
      .map((item) => [item.key, item]));
    const score = this.score;
    const canBuy = s.canUseShop();

    s.bigUpgradesToolbar.forEach((entry) => {
      const item = byKey.get(entry.key) || entry.item;
      if (!item) return;
      const cost = Number(item.cost ?? entry.cost ?? 0);
      entry.buyBtn.setText(`BUY ${formatCompact(cost)}`);
      if (item.purchased) {
        entry.buyBtn.disableInteractive();
        entry.buyBtn.setStyle({ color: '#666666' });
        entry.title.setStyle({ color: '#99ff99' });
      } else {
        const allowed = canBuy && score >= cost;
        if (allowed) {
          makeTextButton(entry.buyBtn, 96, 28);
          entry.buyBtn.setStyle({ color: '#66ff66' });
        } else {
          entry.buyBtn.disableInteractive();
          entry.buyBtn.setStyle({ color: '#555555' });
        }
        entry.title.setStyle({ color: '#ffffff' });
      }
    });
  }

  toggleBigUpgrades() {
    const s = this.scene;
    if (!s.bigUpgradesToolbarContainer) return;
    s.bigUpgradesOpen = !s.bigUpgradesOpen;
    s.shopOpen = s.comboPanelOpen || s.bigUpgradesOpen;
    s.bigUpgradesToolbarContainer.setVisible(true);
    try { s.tweens.killTweensOf(s.bigUpgradesToolbarContainer); } catch (err) { /* ignore */ }
    try {
      s.tweens.add({
        targets: s.bigUpgradesToolbarContainer,
        x: s.bigUpgradesOpen ? s.bigUpgradesToolbarOpenX : s.bigUpgradesToolbarClosedX,
        duration: 260,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          if (!s.bigUpgradesOpen && s.bigUpgradesToolbarContainer) {
            s.bigUpgradesToolbarContainer.setVisible(false);
          }
        }
      });
    } catch (err) { /* ignore */ }
    s.bigToggleBtn?.setText(s.bigUpgradesOpen ? '<' : '>');
    s.bigPagePrevBtn?.setVisible(s.bigUpgradesOpen);
    s.bigPageNextBtn?.setVisible(s.bigUpgradesOpen);
    s.bigPageText?.setVisible(s.bigUpgradesOpen);
    if (s.bigUpgradesOpen) this.refreshBigUpgradesPanel();
  }

  closeBigUpgradesInstant() {
    const s = this.scene;
    if (s.bigUpgradesToolbarContainer) {
      try {
        s.bigUpgradesToolbarContainer.x = s.bigUpgradesToolbarClosedX;
        s.bigUpgradesToolbarContainer.setVisible(false);
      } catch (err) { /* ignore */ }
    }
    s.bigToggleBtn?.setText('>');
    s.bigPagePrevBtn?.setVisible(false);
    s.bigPageNextBtn?.setVisible(false);
    s.bigPageText?.setVisible(false);
    s.bigUpgradesOpen = false;
    s.shopOpen = s.comboPanelOpen;
  }

  goToPreviousBigUpgradePage() {
    const s = this.scene;
    if (s.bigUpgradePage <= 0) return;
    s.bigUpgradePage -= 1;
    this.rebuildBigUpgradesKeepingOpen();
  }

  goToNextBigUpgradePage() {
    const s = this.scene;
    if (s.bigUpgradePage >= s.bigUpgradePageCount - 1) return;
    s.bigUpgradePage += 1;
    this.rebuildBigUpgradesKeepingOpen();
  }

  rebuildBigUpgradesKeepingOpen() {
    const s = this.scene;
    const wasOpen = s.bigUpgradesOpen;
    this.createBigUpgradesPanelToolbar();
    if (wasOpen && s.bigUpgradesToolbarContainer) {
      s.bigUpgradesOpen = true;
      s.bigUpgradesToolbarContainer.x = s.bigUpgradesToolbarOpenX;
      s.bigUpgradesToolbarContainer.setVisible(true);
      s.bigToggleBtn?.setText('<');
      s.bigPagePrevBtn?.setVisible(true);
      s.bigPageNextBtn?.setVisible(true);
      s.bigPageText?.setVisible(true);
    }
  }

  close() {
    const s = this.scene;
    s.shopOpen = false;
    s.comboPanelOpen = false;
    s.bigUpgradesOpen = false;
    s._comboSignature = null;
    s._bigSignature = null;
    try { this.closeComboToolbarInstant(); } catch (err) { /* ignore */ }
    try { this.closeBigUpgradesInstant(); } catch (err) { /* ignore */ }

    const destroy = (obj, key) => {
      if (!obj) return;
      try { s.tweens?.killTweensOf(obj); } catch (err) { /* ignore */ }
      try { obj.destroy(true); } catch (err) { /* ignore */ }
      s[key] = null;
    };
    destroy(s.comboToolbarContainer, 'comboToolbarContainer');
    destroy(s.bigUpgradesToolbarContainer, 'bigUpgradesToolbarContainer');
    destroy(s.comboToggleBtn, 'comboToggleBtn');
    destroy(s.bigToggleBtn, 'bigToggleBtn');
    destroy(s.bigPagePrevBtn, 'bigPagePrevBtn');
    destroy(s.bigPageNextBtn, 'bigPageNextBtn');
    destroy(s.bigPageText, 'bigPageText');
    s.comboToolbar = [];
    s.bigUpgradesToolbar = [];
  }
}
