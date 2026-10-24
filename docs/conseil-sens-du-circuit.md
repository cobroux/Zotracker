# Conseil : Zotracker et le sens du circuit

Compte rendu du 24 octobre 2026. Cinq membres indépendants ont répondu à l'aveugle, chacun avec sa lentille. Cinq relecteurs ont ensuite classé leurs réponses anonymisées, en vérifiant les affirmations dans le code. La synthèse est celle du président.

**Question.** Que vaut Zotracker, et en particulier le « sens du circuit » déployé par la PR #37 ? Il s'agit de chevrons animés sur le parcours restant, orientés vers l'arrivée, espacés d'environ 70 px à l'écran, avec une vague d'opacité de 2,4 s qui court vers l'arrivée. Sur un aller-retour, seul le prochain passage garde son chevron.

## Synthèse

**L'appli.** Les cinq membres la jugent solide et sobre. Sa valeur tient à toute la chaîne : position reçue, recalée sur le parcours, alertes, puis diffusion aux proches. Pour un coureur seul et ses proches, elle couvre ce qui compte : savoir où il est, quand il passe à tel endroit et s'il va bien. La carte n'est qu'une partie de cette valeur.

**Le sens du circuit.** Le principe est juste et bien codé. La règle « seul le prochain passage garde son chevron » répond à la vraie question du supporter : par où il repasse ensuite. Le conseil a vérifié dans le code :
- l'espacement est calculé à l'écran, donc la densité ne change pas avec le zoom ;
- les chevrons ne glissent pas quand le coureur avance ;
- la vague reste continue d'une mise à jour à l'autre ;
- le mode « mouvement réduit » est respecté.

**Défauts relevés**

1. **La vague infinie est le défaut principal. Le conseil est presque unanime.** Jusqu'à 150 chevrons s'animent sans fin, sur une page que les supporters gardent ouverte des heures. Cela coûte de la batterie. Cela détourne aussi l'œil de la seule chose qui doit bouger, le coureur. Et cela enfreint la règle WCAG 2.2.2 (une animation sans fin doit pouvoir s'arrêter). **Décision proposée :** jouer la vague 2 ou 3 fois au chargement et après un zoom, puis figer les chevrons.
2. **Contraste trop faible.** En thème sombre, `#0a1324` sur `#4a6699` donne 3,23:1. Au creux de la vague (opacité 0,55), le contraste tombe vers 2:1, sous le seuil de 3:1 de la WCAG 1.4.11, et le chevron se lit mal au soleil. En thème clair, `#1e3a8a` sur `#9db3d3` donne environ 4,8:1, et environ 2,5:1 à 0,55 d'opacité. Le correctif du point 1 règle aussi celui-ci : des chevrons figés restent à pleine opacité.
3. **Calcul inutile à chaque mise à jour.** `renderChevrons` reprojette tout le parcours, puis `chevronsAlong` dédoublonne en O(n²) avec `kept.some`. Le filtre sur la zone visible ne vient qu'après, et tout recommence à chaque `progress` et à chaque `moveend`. Sur 100 km au zoom 17, cela fait environ 1 500 chevrons candidats. Ça tient, mais il faut d'abord se limiter à l'écran.
4. **Points mineurs.**
   - L'angle vient d'un seul segment du GPX, il peut être de travers sur une trace bruitée.
   - Les tests ne couvrent ni l'exclusion autour du coureur et de l'arrivée, ni le plafond de 150, ni la formule du décalage d'animation.
   - Le dédoublonnage se fait en pixels : au dézoom, deux voies proches peuvent se masquer l'une l'autre.
   - Sur un tracé en 8, le premier passage masque le second au croisement.

**Suite proposée.** Afficher « repasse ici vers HH:MM » sur un tronçon commun d'aller-retour ou à l'endroit choisi avec « Je suis ici ». C'est plus utile qu'un chevron de plus, et ça s'appuie sur les heures estimées que l'appli calcule déjà.

## Notes du conseil

- **Accord :** produit sain, règle du prochain passage juste, animation trop insistante.
- **Vrai désaccord :** des chevrons statiques suffisent-ils ? Deux membres ont fait la même objection contre leur propre avis : un chevron fin et figé sur une ligne bleue se lit mal, et le mouvement se repère sans effort. Le président tranche pour une animation courte puis figée.
- **Ce que le président a écarté :**
  - le retour ne serait pas masqué « sur tout le tronçon commun », mais seulement devant le coureur, et c'est voulu ;
  - le chevron de retour derrière le coureur n'est pas « trompeur », puisqu'il applique la règle du prochain passage.

## Classement agrégé

Position moyenne sur les cinq relecteurs (1 = meilleure) :

| Rang | Membre | Moyenne | Classements |
| --- | --- | --- | --- |
| 1 | Rigoriste | 1,0 | 1 · 1 · 1 · 1 · 1 |
| 2 | Red-teamer | 2,0 | 2 · 2 · 2 · 2 · 2 |
| 3 | Pragmatique | 3,0 | 3 · 3 · 3 · 3 · 3 |
| 4 | Premiers principes | 4,4 | 5 · 4 · 5 · 4 · 4 |
| 5 | Généraliste | 4,6 | 4 · 5 · 4 · 5 · 5 |

Les relecteurs ont pénalisé le comparatif avec la concurrence du Généraliste, invérifiable dans le code et en partie inexact (LiveTrack peut afficher un parcours). Ils ont aussi pénalisé le Premiers principes, peu ancré dans le code.

## Les cinq avis (résumés)

### Red-teamer
Verdict : produit sérieux, le cœur (position, heures estimées, SOS, alertes) répond à un vrai besoin. Le « sens du circuit » est bien exécuté mais apporte peu et échoue là où il servirait le plus.
Hypothèses : spectateur sur téléphone en extérieur, page ouverte des heures ; GPX réel de 5 000 à 20 000 points ; progression fiable.
Où ça casse :
1. Aller-retour : le dédoublonnage glouton à 24 px (course.js:182-187) masque le retour sur tout le tronçon commun. Rien ne dit « il repassera ici dans 40 min », l'info utile. Le seuil en pixels fait apparaître/disparaître des voies proches (trottoirs, lacets) selon le zoom : le même endroit change de sens affiché.
2. Erreur de progression amplifiée : from = s.progress ; si le recalage se trompe de branche, tous les chevrons de l'aller disparaissent et la carte affirme un sens faux. Les 4 tests synthétiques ne couvrent ni bruit GPS, ni voies proches, ni boucles multi-tours.
3. Coût : renderChevrons reprojette toute la trace et calcule les chevrons sur tout le parcours, pas seulement la zone visible ; O(M²) via kept.some à chaque progress et moveend ; puis recrée jusqu'à 150 marqueurs DOM. Au zoom 17-18 sur 100 km, des milliers de candidats. 150 animations infinies : batterie.
4. Lisibilité : trait de 6 px #1e3a8a sur route bleue, 55 % d'opacité au repos, quasi invisible en plein soleil. La vague est un effet de démo.
5. Utilité : sur boucle simple, bornes km, ravitos et marqueur donnent déjà le sens ; le seul cas utile (tronçon partagé) est celui que le point 1 sacrifie.
Ce que je ferais : chevrons statiques, calcul limité à la zone visible, seuil de dédoublonnage en mètres, et sur un tronçon commun une étiquette « repasse ici à HH:MM ».
Objection : fonctionnalité peu coûteuse et encadrée (plafond 150, reduced-motion, horloge partagée) ; « prochain passage » est défendable ; points 3 et 4 non mesurés.

### Rigoriste
Verdict : fonctionnalité solide, aucun défaut bloquant ; coûts cachés et rigueur incomplète sur batterie, contraste, tests du rendu.
Hypothèses : mobile, page ouverte des heures, tracé de 10 à 100 km.
Juste : espacement en pixels (densité constante) ; index i stables car from ne fait que filtrer ; dédoublonnage dans l'ordre des distances garde le prochain passage ; MAX_CHEVRONS dans cet ordre garde les 150 plus proches du coureur. Retard négatif (now − i·STEP) mod FLOW : la vague court vers l'arrivée sans saut au redessin. Seules opacité et translate animées ; non cliquables ; reduced-motion coupe l'animation.
Défauts :
1. Coût : à chaque moveend/progress, reprojection de tout le tracé, kept.some quadratique, recréation de 150 marqueurs. 100 km au zoom 17 ≈ 1 500 candidats ≈ 10⁶ distances par événement. Tenable mais inutile : filtrer d'abord sur getPixelBounds.
2. Batterie : 150 animations infinies forcent un rendu à chaque image, arbitrage non documenté.
3. Contraste sombre : #0a1324 sur #4a6699 ≈ 3,2:1, à 0,55 d'opacité ≈ 2:1, sous 3:1 (WCAG 1.4.11). Animation infinie : WCAG 2.2.2 non satisfait par la seule media query.
4. Orientation : angle d'un seul segment GPX, sans lissage ; bruit au fort zoom.
5. Aller-retour : un chevron « retour » peut apparaître à 26 px derrière le coureur, pointé vers le départ, trompeur ; minGap 24 px supprime des branches proches au dézoom.
6. Tests : chevronsAlong couvert ; rien sur la formule du retard, l'exclusion coureur/arrivée, la limite à 150.
Objection : opacité/translate et 150 nœuds coûtent peu, point 1 = optimisation prématurée (acceptée) ; point 2 récusé sans mesure.

### Pragmatique
Avis : bonne fonctionnalité à garder, deux réserves (batterie, lisibilité en plein soleil).
Tient : aucun coût réseau, tout côté client ; densité en pixels ; plafond 150 et filtre sur la vue ; vague calée sur performance.now() et ch.i, sans état ; pas de chevron sous le coureur ni l'arrivée ni sur la partie courue ; reduced-motion ; animation opacity/translate. Aller-retour : répond à « dans quel sens il repasse ici ? », testé.
Réserves :
1. Batterie : 150 animations infinies, rendu continu sur une page ouverte des heures ; suspendu onglet caché seulement. Correctif : arrêter la vague après quelques cycles, ou la limiter aux ~20 chevrons proches du coureur.
2. Contraste extérieur : bleu foncé sur bleu, 6 px, 2,4 px de trait, opacité 0,55 : risque de disparaître au soleil ; à vérifier dehors.
3. Rendu : destruction/recréation à chaque progress (SSE et « Je suis ici ») et moveend ; acceptable, travail inutile sur entrée de gamme.
Hypothèses : mises à jour toutes les 5-30 s, Android milieu de gamme, page ouverte longtemps.
Objection : sens déjà déductible ; des chevrons statiques suffiraient. Réponse : sur boucle/aller-retour/départ=arrivée le sens n'est pas évident et le mouvement se repère mieux, mais une vague infinie n'est pas justifiée : animer quelques secondes puis figer.
Application : solide et sobre (vanilla, JSON, SSE avec reconnexion, SOS).

### Premiers principes
Position : Zotracker sert les vrais besoins (où est le coureur, quand au point X, va-t-il bien). Chaîne ingestion → projection → alertes → SSE bien identifiée, sécurité sérieuse. Le sens du circuit est de second ordre : juste sur le fond, l'animation coûte plus qu'elle n'apporte.
Info apportée : la flèche ne lève une ambiguïté que sur boucle (sens de rotation), aller-retour/croisement (quel brin ensuite), et avant le départ. En course, la trace faite derrière le coureur donne le sens ; en point à point, départ/arrivée suffisent. La règle « prochain passage » vise juste, testée.
Coût cognitif : l'œil va vers ce qui bouge, or ce qui doit bouger c'est le coureur. 150 chevrons pulsant (vague ~350 px/s) concurrencent le seul signal vivant ; la vague répète l'information de la forme.
Recommandation : chevrons statiques ; vague seulement avant le départ ou quelques secondes après chargement/zoom ; envisager des chevrons seulement aux zones ambiguës.
Hypothèses : le public regarde surtout position et heure ; angle d'un segment GPX bruité non vérifié, une moyenne serait plus robuste.
Objection : un chevron statique fin et sombre sur ligne bleue se lit mal ; le mouvement est le codage que l'œil capte sans effort ; lent et faible amplitude, il reste sous le seuil d'agacement. Sans test utilisateur, la sobriété l'emporte par défaut.

### Généraliste
Verdict : produit solide sur une niche mal couverte. Le sens du circuit est bien exécuté mais c'est une finition, pas un différenciateur : le garder et ne plus y investir.
Positionnement : LiveTrack/Beacon montrent trace et point sans parcours prévu, ravitos, barrières, heure estimée, et dépendent de la montre. LiveTrail/Race Result ont tout ça mais pour l'organisateur, avec pointages discrets. Zotracker = coureur seul et ses proches, n'importe quelle course. Valeur dans la chaîne ingestion → projection → alertes → diffusion.
Chevrons, positifs : espacement en pixels ; dédoublonnage dans l'ordre réglant l'aller-retour, testé ; retard calé sur l'horloge ; plafond 150, filtrage vue, reduced-motion, token. Gain réel avec « Je suis ici ».
Limites : destruction/recréation à chaque progress/moveend, à surveiller sur bas de gamme ; sur tracé en 8, le premier passage masque le second (incomplet, pas faux).
Hypothèses : proches sur mobile, réseau faible ; valeur perçue = où/quand ; un coureur par course.
Priorités : 1) fiabilité terrain (coupure réseau, tampon, « dernière position il y a N min ») ; 2) heure estimée à un point choisi, branchée sur « Je suis ici » ; 3) partage et notifications push au ravito ; 4) multi-coureurs si demandé.
Objection : sens souvent évident ; animation permanente = bruit visuel + CPU/batterie sur une page ouverte des heures. Mais sur boucles/allers-retours la direction n'est pas évidente et la vague reste discrète.
