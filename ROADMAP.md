# Roadmap

In order of importance.

1. **Real physics engine.** Adopt Rapier and move cubes, arrows, rubble, dropped items and building blocks onto it. Start with the buildings, then replace the separate hand-written physics.
2. **Life system.** Player health with a wrist display, a red flash and haptics when hit, and death and respawn. Health for fighters and other characters too. Healing from pickups or slow recovery.
3. **Cool weapons.** An assault rifle (full-auto and semi-auto, two-handed aiming, 30-round magazine with manual reload), throwing axes, a shield, a pump-action shotgun, an energy sword, grenades, special arrows (fire, explosive) and dual guns.
4. **More buildings.** A watchtower, a windmill, a bridge, a village of small houses, and ruins. The block blueprint system makes these quick to add.
5. **Player building (base game).** Part of the core game, always available rather than a feature you switch on in the control panel. A build mode with grid-snapped blocks or pieces, a material picker, undo and delete. Reuses the destructible-block system and the physics engine from item 1.
6. **Random world generation.** A seeded layout of terrain, hills, forests, rocks, buildings and enemy camps. The same seed recreates the same world.
7. **Persistent saves.** Save settings, player-built structures, the world seed and stats. Store them on the headset first (localStorage or IndexedDB), with save slots or backups to the PC later.

Items 1, 5 and 6 build on each other: physics makes building feel right, and saves give builds and generated worlds a reason to last.
