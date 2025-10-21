# GX Browser

Navigateur Electron local inspiré d'Opera GX. Aucun framework lourd, stockage JSON, modules et extensions chargés depuis le disque.

## Installation

```bash
npm install
npm start
```

Le premier lancement crée automatiquement les fichiers JSON nécessaires dans `data/`.

## Structure

```
main.js           # Processus principal (fenêtre, IPC, modules)
preload.js        # Bridge sécurisé (contextBridge)
index.html        # Interface utilisateur
renderer.js       # Logique de l'UI
style.css         # Thème principal
/data/            # Paramètres et données persistant(e)s
/themes/          # Thèmes JSON
/modules/         # Modules système optionnels
/extensions/      # Extensions locales (UI)
/user/            # CSS/JS utilisateur
/assets/          # Médias (vidéo de fond, icônes)
```

## Personnalisation

- **Thèmes** : ajoutez un fichier JSON dans `themes/` avec vos variables CSS. Le champ `wallpaper` peut pointer vers `assets/` ou un `data:` URI.
- **Raccourcis** : modifiez `data/settings.json` (`keybinds`).
- **Modules** : activez/désactivez dans `data/settings.json > modules`. Chaque module possède son dossier (`manifest.json` + `module.js`).
- **Extensions** : déposez une extension dans `extensions/<id>/` avec `manifest.json`, `panel.html` et `panel.js`.
- **UserCSS/UserJS** : éditez `user/user.css` et `user/user.js` (chargés après le thème).

## Données

Les fichiers JSON sont écrits de manière atomique avec sauvegarde `.bak`. En cas de corruption, le navigateur restaure les valeurs par défaut.

## Modules fournis

- `adblock` : blocage basique des domaines publicitaires populaires.
- `downloads` : suivi des téléchargements Electron (`Ctrl+J` via sidebar).
- `media-controls` : lecture/pause de l'onglet actif.

## Extensions exemple

`extensions/example` expose un simple bloc-notes persistant via `localStorage`.

## Vidéo de fond

Le fichier `assets/waves.mp4` est un espace réservé. Remplacez-le par votre propre vidéo (MP4/WebM ≤ 10 Mo) et mettez à jour les thèmes si nécessaire.

## Scripts

- `npm start` : lance Electron.
- `npm run build` : placeholder pour un éventuel packaging.

## Sécurité

- `nodeIntegration: false`
- `contextIsolation: true`
- Accès disque uniquement via IPC sécurisé
- Webviews sandboxés & navigation filtrée
