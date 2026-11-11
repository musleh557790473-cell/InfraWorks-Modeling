# Al Narjis (NRJS, 30% CD): questions for Parsons

Raised while modelling the Sep 2026 submission in InfraWorks (log: `HANDOVER.md`). Each item says what
the model uses until Parsons answers.

| # | Topic | Question | In the model meanwhile |
| --- | --- | --- | --- |
| 1 | Irrigation cover | The IRW-00001/00002 general notes give pipe material and sizes but no cover. What is the cover over the irrigation pipes? | 0.80 m to the crown, AICC assumption (as Al Qairawan) |
| 2 | Water cover | Please confirm the potable water cover: 1.20 m from finished road level to the crown (NWC typical value, given by AICC). | 1.20 m |
| 3 | Kerb return | Junction of ROAD-05's end with ROAD-03: one corner has an arc on RD_CURB_RETURN (R12.00), the other none. What radius? | InfraWorks default 9 m on that corner |
| 4 | ROAD-02 (15m R.O.W) | Its right of way is not drawn as closed __ROW lines like the others. Please confirm section A1 (15 m local road, IRO-30001). | A1, from its name and the "15.00m R.O.W." label |
| 5 | External roads | The four "RD_CL External Road" centrelines have no profiles. Are profiles available, or are these roads outside the scope? | Planning roads, no levels |
| 6 | LV off site | ILV-10000 carries an LV group about 450 m south of the site (substation SSNA001 1000 kVA, DP1-1, a pillar, 19 house connections, 9 cables). Is it part of Al Narjis? | Kept as drawn |
| 7 | Off site east | One distribution substation and a storm line ending at an outfall lie about 200 m east of the site. Please confirm both. | Kept as drawn |
| 8 | Duct depths | No burial depth for telecom, security or street lighting ducts in the drawings or SAPL-DSN-LDN-RPT-000003. What depths apply? | Drawn on the terrain, 0.1 m display size (street lighting: no cable lines drawn) |
| 9 | Street lighting cables | ISL-10000 shows the poles and the panel but no cable routes. Are they to be issued? | Poles and panel only |
| 10 | Water valves | IPW-10000 draws 19 valves (C-WATR-APPT) about 1 km south-east of the site, over some 400 m, with no water pipe drawn there; the site network shows only an air valve and a washout. Where are the valves of the site network, and what are these 19? | The 19 kept as drawn; on site: air valve, washout, 12 fire hydrants |
| 11 | Irrigation valves | IRW-10000 draws 9 isolation valves, 2 of them south of the site (100-300 m); the WaterGEMS model has 3. Please confirm which hold, and the two off site. | All 9 kept as drawn, with the air valve, washout and 2 flow sensor / master valve chambers |
| 12 | Water / irrigation routes | Against IUC-DWG-10000 (nearest corridor, `scripts/narjis/corridor-check.md`): the IPW drawing puts 64 % of the water pipes in the water place, but the WaterGEMS model only 1 % (44 % in the sewer place, 37 % in the storm place). Irrigation, as drawn (IRW) and in its model, lies mostly in the sewer place (46-51 %), 4-8 % in its own. Which is right for the 30% CD? | Both drawn pipes and model pipes in the model, as issued |
| 13 | Storm route | 36 % of the ISW-10000 storm pipes lie in the storm place of IUC-DWG-10000; 54 % lie more than 2 m from every corridor line (including the line off site to the east). Please confirm the storm alignment against IUC. | Pipes as drawn in ISW-10000 |
