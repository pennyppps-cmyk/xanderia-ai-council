# Document Extractor: payslip wage-type codes (Pendapatan / Potongan register)

The payslip extractor sorts every payslip line item into **Pendapatan** (earnings) or **Potongan** (deductions) by its 4-digit code, using the government register *SURAT WAGE TYPE*. A code in neither list gives the warning "Unrecognized wage type codes require review".

- Pendapatan codes: mostly **0001-3999** (0001 = Gaji Pokok / basic salary; 0002 = employer EPF contribution, "TKWSP Majikan"). About 440 codes.
- Potongan codes: mostly **4003-6034** (for example, Angkasa deductions in the 4000s, housing loans, EPF and income tax). About 620 codes.
- Exceptions used by the extractor: **2002 is a deduction**; codes 1500, 1518, 1544, 1546, 1553 and 2024 are earnings; 4824, 5047, 5099, Z002 and Z003 are deductions.
- Angkasa codes used by the APE workspace: 4070, 4101-4109, 0301, 9091. APE PC: 4120-4126, 4131, 4141.

**Caution:** the table below was OCR-transcribed from a scanned letter, so many **names are misspelt** (e.g. "Gay Pokok" is Gaji Pokok, "Majkan" is Majikan). The **codes and categories are reliable**; for a name, check the original SURAT_WAGE_TYPE.pdf before quoting it officially.

## Pendapatan (440 codes)

| Code | Name | PDF page |
|---:|---|---:|
| 0001 | Gay Pokok | 2 |
| 0002 | TKWSP Majkan(75) | 2 |
| 0007 | Goi Pokok (arian) (DR) | 2 |
| 0008 | Kedar Gai Hari (OR) | 2 |
| 0010 | Ium Hari Bekerja (DR) | 2 |
| 1001 | T Gaj (Thn Sms) | 2 |
| 1002 | T.Gaj APtdrn(Thn Sm) | 2 |
| 1040 | T.EIPra-Pkhdntn(T5) | 2 |
| 1041 | T Im Ttp lusa (1L) | 2 |
| 1050 | T.ETp Yain(T-E)(T) | 2 |
| 1052 | T.EKeraian A Par(T5) | 2 |
| 1054 | T.EKetua/Timb K.Dan(T5) | 2 |
| 1055 | TETp Yain (NTE) | 2 |
| 1057 | Imb Tahunan Upahan | 2 |
| 1058 | Im Oar Qrh | 2 |
| 1077 | Pemberian/Bayaran Khas | 2 |
| 1081 | Governmt Advance (DR) | 2 |
| 1082 | Pberian/ByrKhas/insKastam | 2 |
| 1200 | EPemangkuan | 2 |
| 1201 | El Penanggungan Kerja | 2 |
| 1202 | u Pra- Perkhidmatan | 2 |
| 1203 | flaun Sangkut | 2 |
| 1204 | El Penari | 2 |
| 1206 | By Bt Pemhantu Rumah | 2 |
| 1208 | ElKeraluarWktuflkaBliasa | 2 |
| 1210 | E Keraian Ahl Farlimen | 2 |
| 1211 | E1Ketua/Tim K Dwnlkyt | 2 |
| 1212 | Tbalan VPOR/YPON | 2 |
| 1213 | C Ketua Pembangkang | 2 |
| 1214 | r s/u Sulk K. Pemhgkg | 2 |
| 1215 | E1 Anl Dewan Parlimen | 2 |
| 1216 | ElTtgPemandu(ADNg/Rkpt) | 3 |
| 1217 | EI Ttp Bks PM, TPM | 3 |
| 1218 | El Telefon A Primn | 3 |
| 1219 | E1 AN Suruhanjeya | 3 |
| 1220 | El Bantuan Kerja | 3 |
| 1223 | EI Motoskal | 3 |
| 1224 | ESebat | 3 |
| 1225 | B Pengetua Acrama | 3 |
| 1226 | Elaun Cap fari | 3 |
| 1227 | Bths Asing/Bl Bhs | 3 |
| 1228 | EI Khas SkimPrkhdmtn APMM | 3 |
| 1230 | E Khas (Berpencen) | 3 |
| 1232 | El Bidan Kampung | 3 |
| 1234 | El Penempatan Khas | 3 |
| 1235 | RtSalut JiwaTiKusta | 3 |
| 1236 | B Ketukangan | 3 |
| 1237 | KshtnAwm PPigan/Dae | 3 |
| 1239 | Pencegahan Raruah.SPRM | 3 |
| 1240 | El Khas Pasukan (SMART) | 3 |
| 1241 | F1 Dcb (ETR) | 3 |
| 1242 | eGalakan | 3 |
| 1243 | EF Gantian Ttp (ETR) | 3 |
| 1244 | Pra Pihadfur sguruan | 3 |
| 1245 | B-Ei Peperiksaan | 3 |
| 1246 | Pemandu Posmen | 3 |
| 1247 | Bhs Bg lurts Dhnh | 3 |
| 1248 | E Khas Kehak iman | 3 |
| 1250 | EKanak Kanak (ELN) | 3 |
| 1251 | I Tugas Khas Gantung) | 3 |
| 1252 | BI Pernanduen Peniaa | 3 |
| 1253 | BKetukangan-nPenjara | 3 |
| 1254 | D1 Wileyah (BIW) | 3 |
| 1255 | Kecekapan & Lam2 | 3 |
| 1256 | 4setakuan Bask (Wadar) | 3 |
| 1257 | ot Khadmat Euar fieger | 3 |
| 1258 | f Kenderaan Tertap | 3 |
| 1259 | Eaun Fak Berpencen (MR) | 3 |
| 1260 | EI Khas | 3 |
| 1262 | 1 Khidenat Lama | 3 |
| 1263 | El Lantikan Sementara | 3 |
| 1265 | E1 Sara Hdup Luar Nngeri | 3 |
| 1267 | 1 Khas Kehakiman | 3 |
| 1268 | of Detektf | 3 |
| 1275 | T.Monorarum[TS) | 3 |
| 1276 | U.Pencegah Pyeludupan | 3 |
| 1277 | E Ang lemaat Mentr | 3 |
| 1279 | ( Penjagaan | 3 |
| 1281 | E1 Penyela Bik Taip | 3 |
| 1286 | E1 Rating Ruang Angkasa | 3 |
| 1287 | Kaw Traffic UaraDCA | 3 |
| 1288 | Rating Pera Trhang | 3 |
| 1289 | ERumah | 3 |
| 1290 | E Ttp Porjalanan (ETR) | 4 |
| 1291 | Byrn Saguhati | 4 |
| 1292 | Bl Sabah/Sarawak (ATM) | 4 |
| 1293 | B Pmrksa Kapal Tebang | 4 |
| 1294 | E1Sewa | 4 |
| 1296 | m Thailand | 4 |
| 1297 | E Sukar | 4 |
| 1298 | ETak Borpencen | 4 |
| 1299 | SAkdmyPubaPTA | 4 |
| 1300 | Bl Suhjek Penddian | 4 |
| 1301 | r Merryelam | 4 |
| 1302 | El Tanggungjawab | 4 |
| 1304 | El Trengkas Dwi Bhs | 4 |
| 1305 | 1Tetap | 4 |
| 1306 | B1 Pentadbiran Hospital | 4 |
| 1309 | Honorariun | 4 |
| 1310 | EGuru Besar/Pengetua | 4 |
| 1311 | E Penapis Fdem | 4 |
| 1315 | RI Teknial (PORM) | 4 |
| 1316 | E Pesuruhjaya Sumpah | 4 |
| 1317 | f1 Pemhantu Khas | 4 |
| 1318 | El Base Camp | 4 |
| 1319 | El Marard [Hosgital) | 4 |
| 1320 | EKhasPegPubatan Pdaftar | 4 |
| 1321 | Bt Pencegah Kastam | 4 |
| 1323 | El Tugas Memandu Kndin | 4 |
| 1324 | Elaun P.SP | 5 |
| 1325 | KutAwmPeig/ PKD | 4 |
| 1326 | EIl Bntn Hidup Susah | 4 |
| 1327 | TEIP PkIdtn K.Kshtn(T5) | 4 |
| 1329 | I luruiring PgwiPerbadi | 4 |
| 1330 | T.By K.Ptdthern Psktn(TS) | 4 |
| 1332 | E.Dip/B.1.Peg Kshtn | 4 |
| 1333 | B1 Menaip Jami | 4 |
| 1334 | I Pegawai Penernpatan | 4 |
| 1336 | Ein Tgwb Per Penddn | 4 |
| 1337 | f Tewh Khas Pemandu | 4 |
| 1339 | El Perlantilan | 4 |
| 1341 | I1 Mevy Ahi Panel TPA | 4 |
| 1344 | Dy Khas | 4 |
| 1345 | EK/T IsiRumalyPebtuRish | 4 |
| 1349 | (1Kre Lur JPerhutanan | 4 |
| 1350 | Rancangan Perubatan | 4 |
| 1351 | El Perumahan Wilayah EPW | 4 |
| 1353 | U1 Prgm Lthe Kemahiran | 4 |
| 1354 | Tambahan Berpencen | 4 |
| 1356 | Penibyrn Pendhin Plrsn | 4 |
| 1358 | E1 Bhs Sambilan | 4 |
| 1359 | Bi Pegawai Taman Negara | 4 |
| 1360 | I1 Byrn tmb Imam Masjef | 4 |
| 1361 | L PraPrkhidotnKen Kshn | 4 |
| 1362 | Bt Sara Hidup | 4 |
| 1363 | By K. Ptdben Perskutuan | 4 |
| 1364 | m Pskn thas Udare PASKAU | 4 |
| 1365 | By KhagndeaktorNoar | 4 |
| 1366 | B Tetap Bulan Parl | 5 |
| 1367 | El Waktu Birja FleksiPPs | 5 |
| 1368 | has PCF | 5 |
| 1369 | B Luar Waktu Pejabat | 5 |
| 1370 | EK LokasiS Tpesusahan | 5 |
| 1371 | Elaun Khas IProfl | 5 |
| 1372 | EK.LuarKadastraetan | 5 |
| 1373 | ElaunPGA | 5 |
| 1375 | Eaun Pancaragam | 5 |
| 1376 | Elaun Setiausaha | 5 |
| 1377 | Eeun Bot EPC | 5 |
| 1378 | Flaun Mt/Artean | 5 |
| 1379 | Elaun Penterjermah | 5 |
| 1380 | E1 Ketukangan Merin | 5 |
| 1381 | El Ketukangan Amra | 5 |
| 1382 | ElKetukangan Wireless | 5 |
| 1383 | Elaun K9 | 5 |
| 1384 | Flaun Unit Tindak Khas | 5 |
| 1385 | Elaun Orferly | 5 |
| 1386 | Flaun Komando | 5 |
| 1387 | EaunSelenggara Pakaan | 5 |
| 1388 | Elaun Baukal | 5 |
| 1389 | OKetukangn Kenderan | 5 |
| 1390 | El Ketukangan Saifer | 5 |
| 1391 | Elaun Selenggara | 5 |
| 1392 | flaun Trafk | 5 |
| 1393 | Elaun Cawangan Khas | 5 |
| 1395 | El Bantuan Khas | 4 |
| 1396 | E1 Bayaran TOL | 5 |
| 1399 | T.By ins Pkhdnt Jbt(TS) | 5 |
| 1502 | Pomberian Wang Tuna GCR | 5 |
| 1504 | BI Tugas Kewangan | 5 |
| 1505 | BI PbantuPgrsMurd SPKhas | 5 |
| 1506 | Dy Claun & Kemudahan | 5 |
| 1507 | By Sapuhati Khas | 5 |
| 1508 | BI Pengurusan Ster | 5 |
| 1509 | By Khas Ahk Parlimen | 5 |
| 1510 | By Perumahan Khas | 5 |
| 1511 | BI Perudara | 5 |
| 1512 | m Penerbangan | 5 |
| 1513 | By Ins Jururarwat | 5 |
| 1514 | By Balik Gai | 5 |
| 1515 | Ry Ahk Kimia | 5 |
| 1516 | PhdPhitanSungMsie | 5 |
| 1517 | Dy Bit Saraan Pemandu | 5 |
| 1519 | Byrn Ims Tugas Am | 5 |
| 1521 | D Pakar | 5 |
| 1522 | ty Balk Upah taher | 5 |
| 1523 | Bt Penguatkuasa | 5 |
| 1524 | By Khas SSM Bagi KPT | 5 |
| 1527 | By Ins Perkhidentn Bbtn | 5 |
| 1528 | By Belanga Utikei | 5 |
| 1532 | Plesn Byrn Khas Prestas | 6 |
| 1533 | Piesn imb Tahunan | 6 |
| 1534 | Intn Sowa Rumah | 6 |
| 1535 | El Gangguan | 6 |
| 1536 | ProgfemutihPmasyarake | 6 |
| 1537 | E1KmhnS Btuk/Pindnh | 6 |
| 1538 | yB Menyeleggra Rumh | 6 |
| 1540 | 8 Nhas PDRM | 6 |
| 1541 | Porkhadntn Kapal Selach | 6 |
| 1543 | RwtnKcomanmbaylan | 6 |
| 1544 | B shas (tbtn Penjara) | 6 |
| 1546 | Bu Pos Bask | 6 |
| 1547 | BI Penyiasatan | 6 |
| 1548 | Bntn Khas Kwgn Gaj Hari | 6 |
| 1549 | B Prn Sabn | 6 |
| 1550 | B Pnemgatn SbhSakLabuan | 6 |
| 1551 | Khas (PUSPEN) | 6 |
| 1552 | By inventif Peminjaman | 6 |
| 1559 | Burp Prubtn/Pggian Sblirw | 6 |
| 1950 | EKLM Ba Mang | 6 |
| 1951 | EIKLM Rehat Sang | 6 |
| 1956 | EKLM Rehut Malam | 6 |
| 1960 | EIKLM CutiAMalam | 6 |
| 1970 | EIKLM (Amaun) | 6 |
| 1999 | Pelbagai Elaun | 6 |
| 2000 | Tunggakan Gaj(TL) | 2 |
| 2001 | TGaj A Pentadbiran(TL) | 2 |
| 2002 | T.B Perkhdt) | 2 |
| 2003 | TungKWSP Majkan(1L) | 2 |
| 2004 | T Im Ttp Khedrnat Awarm(TL) | 2 |
| 2005 | Tm Ttp PerumahanTu) | 2 |
| 2006 | Jumlah Gaji Harian (OR) | 2 |
| 2007 | TEI Seberang Laut (FL) | 2 |
| 2009 | L ElTtp Ang Pntdbrn(T) | 2 |
| 2010 | LElItp A SlavAwm(TL) | 2 |
| 2011 | T.EITtp A.Parlimen(T) | 2 |
| 2012 | T.ElLebh Masa(TL) | 2 |
| 2013 | LEIKLWBB Perbatan(TL) | 2 |
| 2014 | T.E/e wtayah[TL) | 2 |
| 2015 | rBI Khas Profesional[TL) | 2 |
| 2017 | TEl Tangung Kerja(15) | 2 |
| 2022 | T.EETp Yain(NT-NE)() | 2 |
| 2023 | TETtpYain(T-NE)(TL) | 2 |
| 2050 | T.GajiHarian (DR)(TL) | 2 |
| 2051 | T Elaun Harian (DRH(TL) | 2 |
| 2121 | T.EP.Wlaya(Thn La | 2 |
| 2122 | TEn Pebagal (Thn La) | 2 |
| 2123 | T ElnT Kerja (Thn Lalu) | 2 |
| 2124 | T En Memangku (The Lalu) | 2 |
| 3004 | T Jumlah Gay Harian(T5) | 2 |
| 3005 | T.Privy Purse(T5) | 2 |
| 3008 | T.Elaun Elaun Diraja(TS) | 2 |
| 3011 | TKdr Gaj Hari(DR) | 2 |
| 3012 | Txdr Eln Han(OR) | 2 |
| 3050 | TJmb Ttp fwtnU/GKh(TS) | 2 |
| 3052 | T Inb Tip Prmhn(T5) | 2 |
| 3054 | Timb Ttp Keraian(T5) | 2 |
| 3055 | T.Imb Ttp Khid Awam(T5) | 2 |
| 3070 | T.Imb Tahunan(O-CH(rs) | 2 |
| 3071 | 1.8.K.Prts lusa(O.CHTS) | 2 |
| 3184 | Turg EF Unet T.Khas (T5) | 4 |
| 3200 | T.El Pemangkuan[TS) | 2 |
| 3204 | Im Perumahan Premier | 2 |
| 3206 | Ie Pbantu Rumah Prensier | 2 |
| 3208 | TE Wiokere Bia(s) | 2 |
| 3212 | T.EI TiMD YPOR/YPON(TS) | 2 |
| 3213 | T.B Ketus Prbgke(T5) | 2 |
| 3214 | T.ES/Uult K.PgkgTS | 2 |
| 3215 | T.E AhE Dwn Par(TS) | 2 |
| 3216 | TET P-ADNg/kyt[TS) | 2 |
| 3217 | TEI Ttp BkS PM_TFA(TS) | 2 |
| 3218 | T.ETIfn-A Primn[TS] | 2 |
| 3219 | T.[1Ahl Sehna(TS) | 2 |
| 3223 | T.EI Mnde Morski(TS) | 2 |
| 3224 | T.ElSebat(TS) | 2 |
| 3225 | 1.EP.Asrama[TS) | 2 |
| 3226 | Tung Eln Cap lan(TS) | 2 |
| 3227 | T.E1BAsng/B1.Bs(T5) | 2 |
| 3228 | T.EIS.P.APMM(TS) | 2 |
| 3230 | TEIK Berpencen(TS) | 2 |
| 3232 | T.El Bidan Kg(TS) | 2 |
| 3233 | T.BI Magajar K Cacat(TS) | 2 |
| 3234 | T.El Pnmptn Khas(T5) | 2 |
| 3235 | T.B S liwaTabiKusta[TS) | 2 |
| 3236 | T.El Ketukangan(TS) | 2 |
| 3240 | T.EI Khs Pskn SMARTITSI | 2 |
| 3241 | T.EIDObI ETR(TS) | 2 |
| 3242 | LfGalakan(Ts) | 2 |
| 3243 | TiEln Gantian Ttp ETR(TS) | 2 |
| 3244 | TELP PkheKurPguruan(TS) | 2 |
| 3245 | TE1 Peperesaan(TS) | 2 |
| 3246 | TEPemandy Posmen[T5) | 3 |
| 3247 | 1.18hs1 SKhka(5) | 3 |
| 3248 | IfKhas Kehakaman[T5] | 3 |
| 3250 | TKanak-KankELN(TS) | 3 |
| 3251 | LET Shas Gntug(5) | 3 |
| 3252 | T. Pemandu 1 Pnjra(T5) | 3 |
| 3253 | TKtukangand Pnjra(T5) | 3 |
| 3254 | I.m Wilayah-BW[TS) | 3 |
| 3255 | T.EIKckapan & Lain2(TS) | 3 |
| 3256 | TEInKin BakWd(S | 3 |
| 3257 | TElKhodmat LNegerTs) | 3 |
| 3258 | T.EIKenderaan TetapT) | 3 |
| 3259 | TEn Tak BrgecnMRS | 3 |
| 3260 | T.E KChas(TS) | 3 |
| 3261 | TKhas Tal Brpncn(T5) | 3 |
| 3262 | TE Khidmat Lanta(TS} | 3 |
| 3263 | TflLntie Smetaraf7) | 3 |
| 3264 | T.E tuar Penghulu(7S) | 3 |
| 3265 | T.f Sara Hdup LNgr(75] | 3 |
| 3267 | T.7 Khas Kehakman(T5) | 3 |
| 3268 | T.El Detektif(TS) | 3 |
| 3270 | L.f Paympn Akan(T5) | 3 |
| 3272 | T.E Op Grtor E(TS) | 3 |
| 3273 | T.EI Pakaan 5rgm(T5) | 3 |
| 3275 | T.El salutan(Ts) | 3 |
| 3276 | TErUP Pogeludupan(Ts) | 3 |
| 3277 | TEIA lemaah MentergT5) | 3 |
| 3279 | TAl Penjagaan(Ts) | 3 |
| 3281 | TEl Penyfia R Taip(TS) | 3 |
| 3286 | TERating RAngkasa(75) | 3 |
| 3287 | TEl Ratng Kwl T Udra(TS) | 3 |
| 3289 | TEl Rumah(TS) | 3 |
| 3290 | TEl Ttp Prjlnan-ETR(TS) | 3 |
| 3291 | T.By Sagu Hati(TS) | 3 |
| 3292 | T/Srak-ATM(T5) | 3 |
| 3293 | IBlPmrksa K.Trbg(Ts) | 3 |
| 3294 | TEI Sewa(TS) | 3 |
| 3296 | Tar Thailand(TS) | 3 |
| 3297 | T.EI SUkar(TS) | 3 |
| 3298 | T.f Tak Brpnon(TS) | 3 |
| 3299 | TEI Pcgh Rsh-SPRM(TS) | 2 |
| 3300 | Ta Subj Pendidikan(Ts) | 3 |
| 3301 | To Menyelam(T5) | 3 |
| 3302 | T.El Tangpungiawab(TS) | 3 |
| 3304 | T Trengkas Dwi Bh) | 3 |
| 3305 | TEl Tetap(TS) | 3 |
| 3306 | TEI Ptdiran thuptl(TS) | 3 |
| 3310 | TEIG.Bsr/Pengetua(TS) | 3 |
| 3311 | TEl Penapis Fidemn(TS) | 3 |
| 3315 | TEITeknikal PORM(TS) | 3 |
| 3316 | Y Porhyya Sumpa(s | 3 |
| 3317 | rAl Pembam Khas(s) | 3 |
| 3318 | T Eln Base Camp(T5) | 3 |
| 3319 | 1l racard (Hosp)(T5) | 3 |
| 3320 | T.E8h PPrte P() | 3 |
| 3321 | rBI Pencegah Kastm(S | 3 |
| 3322 | TElKoraan(T5) | 4 |
| 3323 | TEIT Memandu Kndr(F5) | 4 |
| 3324 | T.EMervapu(TS) | 4 |
| 3325 | T.BIK.Awm Pgg/PKD(TS) | 4 |
| 3326 | T.EIK LokasST.S(T5) | 4 |
| 3327 | TfSara Mdp Pemn(15) | 4 |
| 3328 | T.EIn Tugas Khas(TS) | 4 |
| 3329 | 1.f1firng P Prbd(TS) | 4 |
| 3330 | T.El Wdn Asrama(TS) | 4 |
| 3331 | T.ED/BLPeg Kshtn[TS) | 4 |
| 3332 | T.EIT.Mndu A Pdrn(T5) | 4 |
| 3333 | I Bl Menap lawr (TS) | 4 |
| 3334 | T.E1Pgw Pomptn(TS) | 4 |
| 3335 | 1.El Bntn Khas(15) | 4 |
| 3336 | TEIn Tgjwb Per Pdkn(S) | 4 |
| 3337 | TAl Tgwb Khas Pmdu(Ts) | 4 |
| 3339 | TE1 Perfantkan(TS) | 4 |
| 3341 | T Eln Mes A.Panel TPA(TS) | 4 |
| 3345 | TEIK/TL.Rmy/P_Rh(T5) | 4 |
| 3349 | 1.EIK(uar1.Prhtan(Ts) | 4 |
| 3350 | T.Rncgn Perubatan(TS) | 4 |
| 3351 | 1.EIPrmhn Wlyh-EPW(rs) | 4 |
| 3353 | IOnPrgm Lthn Kmhen(T5) | 4 |
| 3354 | El Keraian | 4 |
| 3356 | T.Pbyrn Podhn Pir(TS) | 4 |
| 3358 | Tung Ein Bs Samban( | 4 |
| 3359 | T.Bi Pog Tmn Negara(TS) | 4 |
| 3360 | Le0. imam Masjid(TS) | 4 |
| 3362 | T.Bntn Sara Hidup(Ts) | 4 |
| 3364 | T.BIP.Kh Udra Pastou[TS) | 4 |
| 3365 | T.By tOh M.RitoeNklear(T5) | 4 |
| 3366 | TE Tetap fulanan Pacol | 4 |
| 3367 | T.EI W.krja Floksi(TS) | 4 |
| 3368 | Tung Flaun Khas PCF | 4 |
| 3369 | T.Bl Luar Wakto Peyaher | 4 |
| 3370 | T.EI Khas Lokas&Tksh(TS) | 4 |
| 3371 | Tung EF Luar Neger (75) | 4 |
| 3372 | Tung El Sara Hfp (N) | 4 |
| 3373 | Tung Elaun P GA (T9) | 4 |
| 3374 | Tung Elaun PS.P (Ts) | 4 |
| 3375 | Tung Ein Pancaragam (T5) | 4 |
| 3376 | Tung Ein Satiausaha (TS) | 4 |
| 3377 | Tung EIn Bot EPC (TS) | 4 |
| 3378 | Tung En Mt/Artiran (T) | 4 |
| 3379 | Tug EnPontee) | 4 |
| 3380 | Turg Ein Ketkgn Mern(7S) | 4 |
| 3382 | Tung En Kegn Amra() | 4 |
| 3383 | Turg Elaun K9 (T5) | 4 |
| 3385 | Torg Elaun Orderly (T5) | 4 |
| 3386 | Tung Elaun Komando (Ts) | 4 |
| 3387 | lung (IS.Pakaian (T5) | 4 |
| 3388 | Tung Elaun Basikal(Ts) | 4 |
| 3389 | 1Eln Ketign Kndan (Ts) | 4 |
| 3390 | TOn Ketkgn Saifer (T5) | 5 |
| 3391 | Tung Eln Selenggara (TS) | 5 |
| 3392 | Tung Claun Trafhk (15) | 5 |
| 3393 | Tung Flaun Caw Khas (Ts) | 5 |
| 3394 | I Bnt Sara Hdp P.Brpencen | 5 |
| 3399 | Turg Ein Unfarm G.0 (5) | 5 |
| 3500 | T.BPrkhid Kritikal(TS) | 5 |
| 3501 | I By Khas Peg PrflT5) | 5 |
| 3502 | L Pberian W Tna-GCR(5) | 5 |
| 3504 | 1.Be Tugas Kewgn(TS) | 5 |
| 3505 | Ta PPgran Mrd SPK(TS | 5 |
| 3506 | T By EIn &kemudhan(TS) | 5 |
| 3507 | I By Saguhati thas(TS) | 5 |
| 3508 | I aI Pgrun Stor(TS) | 5 |
| 3509 | T.By Khs A Palimen(5 | 5 |
| 3510 | 1.By Prmhe Khas(TS) | 5 |
| 3511 | T.Bl Perudara(TS) | 5 |
| 3512 | T.BI Penerbangan(TS) | 5 |
| 3513 | T.By Ins lururawat(75) | 5 |
| 3514 | T.Dy Balik Gaj(Ts) | 5 |
| 3515 | I. fy Ahl KameT5) | 5 |
| 3516 | T. P.PidhitanSMsia(TS) | 5 |
| 3517 | T.By Saraan Pemandu(T5) | 5 |
| 3518 | Tung B1 Tugas Arm (T5) | 5 |
| 3519 | T.By Blk (k Knderaan(TS) | 5 |
| 3520 | T.8l Pakar(TS) | 5 |
| 3521 | Ter Btugas B.Mayat[T5) | 5 |
| 3522 | T By Balk Upah ahit(TS) | 5 |
| 3523 | T.BI PenguatuaaT5) | 5 |
| 3524 | T.Oy K SSM g KPT(TS) | 5 |
| 3528 | T.By Belanja () | 5 |
| 3532 | T.Pirun Byen K Prstu(TS) | 5 |
| 3533 | Tung Plesn imb Thunan(TS) | 5 |
| 3534 | T.Bntn Sewa Rmh(TS) | 5 |
| 3535 | T.El Gangguan(TS) | 5 |
| 3536 | T.BLPPmihoPmyron(S) | 5 |
| 3537 | T.E1KmdnSk/P.Rh(TS) | 5 |
| 3538 | T.0yBt Mnylggara Rmh(T5) | 5 |
| 3540 | T.BIKhaSPDRM(TS) | 5 |
| 3541 | 1.4 Hazmat(T5) | 5 |
| 3542 | T.BI Pkntn K Sam[TS | 5 |
| 3543 | TK | 5 |
| 3544 | T.BKhs Iben Penjara(T) | 5 |
| 3546 | T.0I Pos Basil(TS) | 5 |
| 3549 | T.B1Rmh SbhSrw(ab(T5) | 5 |
| 3550 | T.0I Tmpt SbhSrwab(5) | 5 |
| 3551 | T.BI PUSPEN (1S) | 5 |
| 3552 | 1By Ins Pemiaman (5) | 5 |
| 3559 | BPP Prubtn/Pgglan SS(TS) | 5 |
| 3999 | Tung Pelbaga Flaun(TS) | 5 |

## Potongan (624 codes)

| Code | Name | PDF page |
|---:|---|---:|
| 4003 | A/K Pmbayaan Risda | 7 |
| 4004 | Plg Ble Privy Purse | 7 |
| 4005 | Phe nk El Knraian Diraga | 7 |
| 4006 | g ak El Diraja Ist Neg | 7 |
| 4010 | Prgn Insuran ETIaA (M) | 7 |
| 4011 | By Blik inm Tahunan | 17 |
| 4012 | Byrn alk B TS (Tax) | 7 |
| 4013 | Oyr k Khs Prestasl luta | 17 |
| 4014 | Skimn Pncn Balu/A Vtm Smk | 7 |
| 4015 | Dyrn BRk EI TS (N-Ta] | 7 |
| 4016 | Trime Blk Byrn Thn Lake | 7 |
| 4017 | Dyrn Blk Gaji Thn Semasa | 7 |
| 4018 | Lan Pige Bk Pbelanjaan | 7 |
| 4019 | Dyr Blk or Khas Kewangan | 7 |
| 4021 | fyrn Blk Pemberian Khas | 7 |
| 4022 | Pelarasan Gapi | 7 |
| 4024 | Lain-Lain Potongan | 17 |
| 4025 | PelDenda Prpn & Hukuman | 17 |
| 4026 | Dends Plegswai Awam | 17 |
| 4029 | Coshare Holdings Berhad | 7 |
| 4030 | Byrn Utdt Prakin M'sia | 17 |
| 4032 | KIb Skn & Kbjn JANMKE | 17 |
| 4034 | Pbdn MemayIktsad NTganu | 17 |
| 4040 | Peng Besar Ketengch | 7 |
| 4041 | Lem Kemaj Johor T'gara | 17 |
| 4042 | Len Kemaj Wi Kedah | 7 |
| 4047 | Sabah CreditCorporation | 17 |
| 4048 | Sen Pgn Saah Krdt Corp | 7 |
| 4052 | Kesan Seriwak | 7 |
| 4053 | Sykt Takafu/M*Sia 5.8 | 7 |
| 4059 | Sen Wang Entergrise | 17 |
| 4070 | B fing lohor | 17 |
| 4071 | B Nieg Kedah | 17 |
| 4073 | B.Nieg, Meleka | 7 |
| 4075 | B. Nog P Pinang | 17 |
| 4077 | B.Neg. Peris | 7 |
| 4078 | Pend Knmp Ben Neg Sahah | 7 |
| 4079 | B fieg Terenggang | 7 |
| 4080 | B.Neg. Selangor | 7 |
| 4082 | B Neg Melaka Tbg Myd | 7 |
| 4085 | SUK Kelantan | 7 |
| 4087 | SuK Pahang-Pendahuluan | 7 |
| 4088 | SUK Pahang | 7 |
| 4090 | SUK Perlis | 17 |
| 4097 | SWRmh Rkyt SUK Johor | 7 |
| 4098 | SW Rmh Rkyt SUK Kedah | 17 |
| 4099 | SWRmh Rkyt SLUK NS | 7 |
| 4100 | SW Rmh Rkyt SLK Perak | 7 |
| 4101 | sw RmtyPie BNeg Johoe | 8 |
| 4102 | w Rmh/Prht B.NogKedah | 17 |
| 4103 | Sw RmtyPt BNg Klntan | 8 |
| 4104 | A/K Pnbiayaan Risda | 17 |
| 4105 | SW Rah/Prhe B fieg NS | 8 |
| 4106 | SW Rmh/Prbt B Ng P.Png | 17 |
| 4107 | SWRn/Prt B.Ng Pahag | 8 |
| 4108 | SwRmh/Prbt B.Neg Perls | 8 |
| 4109 | SwRmh/Prbt B.Neg Salah | 8 |
| 4110 | S Rm/PrbtBNeg Sngor | 17 |
| 4111 | Sw Rmh/Pit B.Ng Tganu | 8 |
| 4112 | Sw Rmt/Per1 Pnrbgn Awm | 8 |
| 4113 | SW Rm/Prhet IKM | 17 |
| 4114 | Sw Rosh/Pebt IKR | 17 |
| 4115 | SW Rmh/Prbt IPT | 17 |
| 4116 | SW Smh/Prbt K. Kerja Raya | 17 |
| 4117 | SwRedPrbe x.Resthutan | 8 |
| 4118 | SwRm/PrbeK.Penddikan | 8 |
| 4119 | SW Rmh/Pbe K. Pertarian | 8 |
| 4120 | Sw Rmh/Prbt K. Ptahanan | 8 |
| 4121 | SWRoehPtKasta &Eks | 8 |
| 4122 | Sw Rmh/Prbt Keragaan | 17 |
| 4123 | Sw Rmh/Frbt Labuan | 8 |
| 4124 | SW Rmh Prbdn Labuan | 8 |
| 4125 | sw Rmh/Prht Sabah | 8 |
| 4126 | SW RmlyPrht Sarawak | 17 |
| 4127 | Sw Rmh/Prbt suK Perak | 8 |
| 4128 | Sw Rmh/Fybt Wilayah | 8 |
| 4129 | KSu -Pnj Prmhn Mrth | 8 |
| 4130 | Pen SU Caw Prmhn lohar | 8 |
| 4133 | Ans Rrh Mrh. Ketengah | 8 |
| 4134 | Ans Rah.Mrh. Selangor | 8 |
| 4138 | Barneo Housinng Mortgage | 8 |
| 4140 | Ping Perumahan Satu Tmbh | 8 |
| 4141 | Pinj, Perumahen Saty | 17 |
| 4142 | Pirg Perumahan Dua | 8 |
| 4146 | Pirg Perumahan Dua Tmbh | 8 |
| 4148 | Sjaya Prmhae Sarawak | 17 |
| 4150 | M'sia Bidg Soc Bhd | 8 |
| 4151 | Sewa Asrama KKeshatan | 8 |
| 4152 | Sewa Berganda | 8 |
| 4153 | Sewa Kusrters lUPEM | 17 |
| 4154 | Dyen Ap(Air AamTel | 8 |
| 4155 | Byrn Perkhidmatan Yg Lain | 8 |
| 4156 | Dyen Bik Phen Kden B5N | 8 |
| 4162 | KP1 Malaysia | 8 |
| 4171 | SwRmh/Prht Kstam&Es | 17 |
| 4178 | Pend Kend IAN Sarawak | 17 |
| 4179 | Pend Kend sAN Sabah | 17 |
| 4180 | Pend Kend Ben Neg Sabah | 8 |
| 4182 | Pend Kenderaan BSN | 17 |
| 4183 | Pend Kenderaan BCB | 8 |
| 4185 | 1 Pd-Ang/Sare Hdp O Msia | 8 |
| 4186 | 2-Pd-Ang/Sara Hdp D Msia | 8 |
| 4187 | 3-Pd-Ang/Sara Hdp D Msa | 8 |
| 4189 | 1-Pd-Ang/Sara Hdp L/Ngri | 8 |
| 4190 | 2Pd-Ang/Sara Hdp L/Ngr | 8 |
| 4191 | 3.Pd Ang/Sara Hdp L/Ngr | 17 |
| 4197 | Pd-KPendidikan | 8 |
| 4200 | Peg Daerah Sg Siput | 17 |
| 4201 | Pd-Sarawak | 9 |
| 4203 | 1-Denda P-Ang/Sratidp Ms | 17 |
| 4204 | 2 Denda Pd-Ang/Saradp Ms | 17 |
| 4205 | 3-Dende Pd Ang/SaraHdo Ms | 9 |
| 4207 | 1-Dende Pd-Ang/Saradpt/N | 9 |
| 4208 | 2-Dende Pd-Ang/Saradpt/N | 9 |
| 4209 | 3Denda Pd-Ang/SaradpL/N | 9 |
| 4211 | Pend Pelbg IPA | 17 |
| 4215 | Pend Pelly Sahah | 9 |
| 4225 | Pelb PignPenjara,SPetani | 17 |
| 4241 | Pen Peg Daerah Ipoh | 9 |
| 4245 | Peg Daerah Kinta | 9 |
| 4247 | Peg Daecah Perak Tgh | 9 |
| 4249 | Peg Daerah Hiir Perak | 17 |
| 4250 | Peg Daerah& Tnh Gerk | 9 |
| 4253 | Peg Daerah Kroh | 9 |
| 4259 | Peg Daerah Kg Gajah | 9 |
| 4260 | Peg Danvah Sg Siput | 9 |
| 4272 | Peg Daerah Kuala Pilah | 17 |
| 4274 | Peg Darrah Rernbau | 9 |
| 4299 | Pr-Pgrh Penjara Ainr Str | 17 |
| 4300 | Prnjaman Komputer Mara | 17 |
| 4303 | PMD Nomanees (TPT] S/B | 17 |
| 4304 | Pinjaman Pelayaran Mara | 9 |
| 4306 | Pingaman Kornputer Mara | 9 |
| 4307 | Biasiswa K.Pendidikan | 17 |
| 4308 | Biasswa Sarawak | 9 |
| 4311 | Biasiswa Kedah | 9 |
| 4312 | Basiswa Selangor | 17 |
| 4313 | PPK POUS BRIGED TENGAH | 18 |
| 4315 | Basirwa Perak | 9 |
| 4317 | SU Bah Thg Ferbangunan | 9 |
| 4319 | Dyrn Sk Ping Pin KPT | 9 |
| 4321 | Dyen Tuntutan G/Rug IPA | 9 |
| 4322 | Byrn Bik Ping Ply IPA | 9 |
| 4323 | Byrn Blk Piny Pendidikan | 17 |
| 4325 | Yayasan Pahang | 9 |
| 4327 | Lm.Pem Amnsh Tab Ptut PP | 9 |
| 4331 | Yay. Terengganu | 17 |
| 4332 | Yay.Tunku Abd Rahman K | 9 |
| 4333 | Yay. Sabah | 9 |
| 4334 | Vay. Pelajaran Johor | 9 |
| 4335 | Yay. N.Semblan | 9 |
| 4336 | Yay Kelantan | 9 |
| 4339 | Yay. Selangor | 9 |
| 4340 | Yay. Sarawak | 17 |
| 4344 | Ping Pelajaran UUM | 9 |
| 4352 | Coop Pole DiRaja Msia | 9 |
| 4353 | Coop-Peg Melayu Mua Bd | 9 |
| 4354 | Coop-Sarawak Gov Ee T&LS | 17 |
| 4355 | Kop Pelerja Kin Sabah Bhd | 9 |
| 4356 | Coop Fed Armed Forces | 9 |
| 4357 | Coop-Sy Kop Polis P Png | 17 |
| 4361 | Kap Bersekutu P Pig Bhd | 9 |
| 4362 | Zakat PPz Wiayah Persktn | 9 |
| 4363 | Zakat-PPZNeg Semlan | 9 |
| 4366 | Zakat PPZ Terengpanu | 9 |
| 4367 | Zakat Puz Pulau Pinang | 9 |
| 4368 | Zakat-MUI Kelarrtan | 9 |
| 4369 | Zakat-Mut Pahang | 10 |
| 4370 | Zakac MUl Sabah | 10 |
| 4372 | Byrn Bik Pinj,Pir PA | 17 |
| 4373 | Wakaf Thg Batumal Swak | 10 |
| 4374 | Zakat-MAl Perfis | 10 |
| 4375 | Zakat-MAI Melake | 10 |
| 4376 | Zakat-MAl Selangor | 10 |
| 4377 | ZakatS/u 1/k Zkt Kedah | 17 |
| 4379 | DERKAT | 10 |
| 4380 | Zakat ak Zktrah tor | 17 |
| 4382 | yEM Phgn Eko lam Msa | 10 |
| 4383 | Yayesan Idam Kedah | 10 |
| 4385 | Zakar-Thg SatuimalSwak | 10 |
| 4387 | Zakat-Ky Mjd lamnk Sw | 10 |
| 4388 | Prtbhn Keb Melay Bfsatu | 10 |
| 4389 | Ub-Kehaj Perbendaharaan | 17 |
| 4391 | KIb-SukanSKebaKKRM | 10 |
| 4392 | Klb-Skn Kom Prumah Tpt KL | 10 |
| 4393 | Kelah KRFSRA | 10 |
| 4394 | b SknSKebaj ANM loh | 17 |
| 4395 | KIb Shn & Kehaj ANM | 10 |
| 4397 | -Kes Pkhtn Teink KL | 10 |
| 4400 | b-Kes Guru-Guru Sarawak | 10 |
| 4402 | Kh Pkh Keran Krin Ktn | 10 |
| 4403 | Klb Kes Pemandu Pret | 17 |
| 4408 | lbu Pej. BN | 17 |
| 4410 | Kump Wang Batumal Srwk | 17 |
| 4412 | Akauntan Negeri Sarawak | 17 |
| 4413 | Byr Api/Air Kem Perthnn | 17 |
| 4414 | Sumhangan KWAPM | 10 |
| 4415 | Pign Balik Belanja Lthn | 10 |
| 4419 | Kib-seff fikn Akdmnk KMNS | 10 |
| 4420 | SW Rmh/Prte LADA | 17 |
| 4421 | Skirn Dana Wakaf PPinang | 10 |
| 4422 | Arnanah Wakal Pahang | 10 |
| 4424 | Pernama | 10 |
| 4429 | Thg Amaath Pd Melaka | 10 |
| 4432 | Pend Pelbg Parlimen | 10 |
| 4433 | PTPTN | 10 |
| 4434 | SwRrhyPrbt WPkutunPM | 17 |
| 4435 | Sw Rmh/Prbt Kerajaan PM | 17 |
| 4454 | Sw Rroh/Prot wPkutuan PM | 10 |
| 4474 | Yayasan Wagaf Malaysia | 10 |
| 4475 | Pend. Sekolah Dim Neger | 10 |
| 4476 | Pirgaman Peribad B5N | 17 |
| 4536 | Tbg SukanKbjkn Pul Kch | 12 |
| 4545 | Kelab Perbendaharaan PIY | 17 |
| 4546 | Byen Nafkah Betumal Shh | 10 |
| 4547 | Plg Bk ITP Kuarters | 10 |
| 4548 | Pg Bik BSH Kaarters | 17 |
| 4549 | Ple Bk BrSwRmh Kuarters | 10 |
| 4550 | Pig Bik EPW Kuarters | 17 |
| 4551 | Kelab KPT | 10 |
| 4552 | MESCA | 10 |
| 4553 | Kelab KDN | 10 |
| 4554 | Thg Kunp Wang Amal sariah | 10 |
| 4555 | Pg Bik in Ttp Keraian | 17 |
| 4561 | Kelab Khikn& Sukan APMM | 10 |
| 4562 | Dep. Sewa Rumah Luar Neg | 17 |
| 4563 | Pend Dop. Yuran Sekolah | 10 |
| 4564 | Bds Kabagkan&Sukan Eu | 17 |
| 4565 | Yayasan Thsan Rakyat | 17 |
| 4566 | Kelab IPBDSM | 17 |
| 4567 | CUEPACS-Takaful Ikhlas | 17 |
| 4568 | CUEPACS-MAA Takaful | 11 |
| 4569 | CUEPACS-Hong Leong MSIG | 11 |
| 4571 | L Destinasi Sdn Bhd | 17 |
| 4572 | Skim WakafTuna(MANS) | 11 |
| 4573 | Skim Wakaf Tunai [MAPK) | 11 |
| 4574 | Kelab Pelis Kuala Lumpur | 17 |
| 4575 | Kelah Polis Putrajaya | 17 |
| 4576 | TgKhykn Polis Dae Cheras | 11 |
| 4577 | Kelab Polis Senrtul | 17 |
| 4578 | Kelab Polis Dae DangWangi | 17 |
| 4579 | Kelab Polis Trafik | 11 |
| 4580 | Kelab Polis Brickfields | 11 |
| 4581 | Bend KlbPois Pulapol | 17 |
| 4582 | Bend KIbPolis IPK N.S bin | 17 |
| 4583 | Bend Kibolis Seremban | 17 |
| 4584 | Bend KibPolis Rembau | 11 |
| 4585 | BendKlbPolisJelebu | 17 |
| 4586 | Bend KhPulis Jempol | 11 |
| 4587 | Bend KibPols Kuala Pilah | 17 |
| 4588 | Bend xIhPolis P.Dickson | 11 |
| 4589 | Bend KibiPols Tampin | 17 |
| 4590 | Bend KIbPols PS.PShan | 11 |
| 4591 | Kelab Polis IPK Melaka | 17 |
| 4592 | Kelab Polis IPD MerakaTgh | 17 |
| 4593 | Kelab Polis IPD Jasin | 17 |
| 4594 | Kelab Polis IPD AlorGajah | 17 |
| 4595 | Kelab Pulapol Air Hitam | 17 |
| 4596 | Kelab Pols IPD Utara | 17 |
| 4597 | Kelab Pols IPD K.Tinggi | 17 |
| 4598 | Kelsb Polis IPD Segamet | 17 |
| 4599 | Ketab Polis Pontian | 17 |
| 4600 | Kalab Polis IPD Merung | 11 |
| 4601 | Kelah Polis IPD Shah Alarm | 18 |
| 4602 | Kelab Polis Daerah Muar | 17 |
| 4603 | Kelad Polis IPD BauPalat | 11 |
| 4604 | Kelab Pelis IPo Slatan | 11 |
| 4605 | Kelab Polis PSP 21.Bahru | 11 |
| 4606 | Kelab Polis IPK sohor | 11 |
| 4607 | Kelab Polins Marin Tampoi | 11 |
| 4608 | Bend KbPois IPD Kangar | 11 |
| 4609 | KlKbknSRkreaPdgBesar | 11 |
| 4610 | Kelab Folls Bgd Sabah PGA | 11 |
| 4611 | YOptua KibPs BN14 PGA | 11 |
| 4612 | Byrn Blk EI TS (N-Tax) | 17 |
| 4613 | Kelab Polis BN 16 PGA | 11 |
| 4614 | Bend KbPolis BN 17 PGA | 11 |
| 4615 | Kelab Polis IPK Sarawak | 17 |
| 4616 | Kelab Polis Bararm | 11 |
| 4617 | Kelab Pals Cwgn Meradong | 17 |
| 4618 | Kelab Polis iPD julau | 11 |
| 4619 | Kelab Pelis IPD Bau | 11 |
| 4620 | Kelab Polis IPD Betong | 11 |
| 4621 | Kelab Polis IPD Bimtulu | 11 |
| 4622 | Kelab Pelis IPD Dalat | 11 |
| 4623 | Kelab Polis iPO Kanowit | 11 |
| 4624 | Kelab Polis IPD Kapit | 11 |
| 4625 | KelabFes IPD KS'mrtn | 11 |
| 4626 | Kelab Pelis iPD Kuching | 11 |
| 4627 | Kelab Polis IPD Lundu | 11 |
| 4628 | Kelab Polis IPD Miri | 12 |
| 4629 | Kelab Polis IPD Mukah | 12 |
| 4630 | Kelab Polis IPD Saratok | 12 |
| 4631 | Karlab Polis IPD Senan | 17 |
| 4632 | Kelah Polis IPD Siu | 17 |
| 4633 | Kelab Pois IPD Song | 17 |
| 4634 | Kelab Pols IPD Tatane | 12 |
| 4635 | Kelalb Polis IPD Sankei | 17 |
| 4636 | Tbg KelahPolis Dae. Mau | 17 |
| 4637 | Thg SukanBn Pul kch | 17 |
| 4638 | Bend KlbPolis Bed T'gara | 17 |
| 4639 | Bend KIbPolls BN 7 PGA | 17 |
| 4640 | Bend KbPolis BN 8 PGA | 17 |
| 4641 | Bend abPolis F Bgd Tngh | 12 |
| 4642 | BendKlbPoln B Tngh | 17 |
| 4643 | Bend KtbPolis BN 4 PGA | 17 |
| 4644 | Kelab Pols BN S PGA | 12 |
| 4645 | Bend KlbPolis BN 6 PGA | 12 |
| 4646 | Bend KIbPelis BN 19 | 12 |
| 4647 | KlbPols IP fed Utara PGA | 12 |
| 4648 | Bend KihiPolis BN PGA | 12 |
| 4649 | Kelab Pols BN 2 PGA | 12 |
| 4650 | Kelab Warga BN 3 Grkn Am | 12 |
| 4651 | Kelab Pois BN 18 PGA | 12 |
| 4652 | Bend KIPos BN 6O KPGA | 12 |
| 4653 | Kelab Pols PLPGA | 12 |
| 4654 | Kelab Pols iPk Perak | 12 |
| 4655 | Kelab Polis Batu Gajet | 12 |
| 4656 | Kelab Pols Genk | 12 |
| 4657 | Kelab Pols Feluk intan | 12 |
| 4658 | Kelad Polis Ipoh | 18 |
| 4659 | Kelab Polis Marin | 12 |
| 4660 | Felab Polis Kuala Kangsar | 12 |
| 4661 | Kelab Polis Kampar | 12 |
| 4662 | Ketab Polis Kerian | 12 |
| 4663 | Kelab Polis Pengkaantu | 12 |
| 4664 | Kelab Pols Pengkalanulu | 18 |
| 4665 | Kelab Polies Perak Tengals | 12 |
| 4666 | Kelab Polis PSP No.5 1ph | 12 |
| 4667 | Kelab Pois Teluk Intan | 18 |
| 4668 | KelabPolis LrtMtg/Selama | 12 |
| 4669 | Kelab Polis Sungai Siput | 12 |
| 4670 | KIb Pols Pasir Mas (UPP) | 12 |
| 4671 | Kelab Poln IPD Bintuke | 17 |
| 4672 | Kelad Kbikn Sukan Labuan | 12 |
| 4673 | KelabPolis iPD KKnahalu | 12 |
| 4674 | Kelab Pells IPD Kudat | 12 |
| 4675 | Kelab Pols Kontingen | 18 |
| 4676 | Kelab Polis Dae.Bachnk | 12 |
| 4677 | KelabPolis Dae Gua Musang | 12 |
| 4678 | Kelab Polis Dae.sel | 18 |
| 4679 | Kelab Pos DaeKotafharu | 18 |
| 4680 | fend KibPols Dae.K | 18 |
| 4681 | KelabPolis Dae.Machang | 18 |
| 4682 | Kelab Pois Dae Paur Mas | 18 |
| 4683 | Kelab PolsDaePPuteh | 18 |
| 4684 | Kelab Pois Dae Inh Morah | 18 |
| 4685 | Ketab Pals Dae Tumpat | 18 |
| 4686 | Bend KbPols Selangor | 18 |
| 4687 | Bend KPois PD Kaang | 18 |
| 4688 | Bend KbPolsKSelangor | 18 |
| 4689 | Bend KibPolis K Langat | 12 |
| 4690 | Kelab Pols Sabak Berrsarm | 12 |
| 4691 | Kelab Polis IPD Shah Aare | 12 |
| 4692 | Kelab Polis Petalng lirya | 12 |
| 4693 | Kelab Polis Subang lane | 12 |
| 4694 | Ketua Polis Deerah Gombak | 18 |
| 4695 | Bend Khet KIbPols B.Amn | 18 |
| 4696 | Kelab Polis MactabK | 18 |
| 4698 | Kelialb Pols urk Pahang | 18 |
| 4699 | Kelab Polis IPDKuantan | 18 |
| 4700 | Kalab Pols IPD Pokan | 18 |
| 4701 | Kelab Polis IPD Bentong | 18 |
| 4703 | Kelab Pols IPD Jerantut | 18 |
| 4705 | Kelab Pols IPD Lipis | 18 |
| 4706 | KlbPols IPD C/Hghlands | 18 |
| 4707 | Kelab Puls IPD Bera | 18 |
| 4709 | Kelab Polis IPD Maran | 18 |
| 4710 | Kelab Pols tP Tganu | 18 |
| 4711 | Kelab Pols Dungun | 18 |
| 4713 | Kelab PolsPSP6PK Tg | 18 |
| 4714 | Bend KlbPolo K.T'gany | 18 |
| 4715 | Bend KlbPois Marang | 18 |
| 4716 | Bend KbPols Setiu | 18 |
| 4717 | selab Polis Kemaman | 18 |
| 4718 | BendSbPolisHul Tganu | 18 |
| 4719 | KlhSSu Polis Daerah Besut | 18 |
| 4720 | Kelab Pols Barat Daya | 18 |
| 4721 | Klb Poks Sbrg Perai Sn | 18 |
| 4722 | KelabPolisMerin PPiang | 18 |
| 4723 | YOpt KbPolsSPT Mjam | 18 |
| 4724 | YOptue KlbP SPU B/wth | 18 |
| 4725 | YDptua KibPolsGeogetown | 18 |
| 4726 | Bend.KbPols K K | 18 |
| 4727 | Bend Kelab IPD Raling | 18 |
| 4728 | Bend Kelab IPD Bandar Bha | 18 |
| 4729 | Bend Kelab IPO Kota Star | 18 |
| 4730 | Bend KelabiPD Kuala Muda | 18 |
| 4731 | Bend KelabiPD Kubang Pasu | 18 |
| 4732 | Bend Kelab iPD Kulm | 18 |
| 4733 | Bend KelabIFD Langkw | 18 |
| 4734 | Bend Kelab IPD Pdg Terap | 18 |
| 4735 | Bend Kelab IPD Pendang | 18 |
| 4736 | Bend Kelab IPD Sik | 18 |
| 4737 | Bend KelabIPD UPP | 18 |
| 4738 | Bend Kelab IPD Yan | 18 |
| 4739 | Kelab Polis E1 KL | 18 |
| 4741 | KhPoas Pskn Simp P'sktn | 18 |
| 4742 | YDptua Kelab Pulapol Moar | 18 |
| 4743 | KIbPolis Bde Srwk PGA | 18 |
| 4747 | KIbPolis BN12 PGA Min | 18 |
| 4748 | KibPolis CKoiBN12Lmg | 18 |
| 4750 | KlbPoln Tanjung Malim | 18 |
| 4752 | Keiab Polis Taiping | 18 |
| 4754 | Kelab Polis IPD Sen Alam | 18 |
| 4755 | Kelab Polis Sandakan | 18 |
| 4756 | Kelah Pols Marin Kuantan | 18 |
| 4757 | Kelab Polis Daerah Sepang | 18 |
| 4758 | Kelab Polis Amang laya | 18 |
| 4759 | Kelab Pols IFD Nusajaya | 18 |
| 4760 | Kelab Pols IPD Ledang | 18 |
| 4761 | KELAS POUS IAB LOGISTIK | 18 |
| 4763 | Kelab Mann Pagkin Kubr | 18 |
| 4764 | Kelab Pols O Kulaaa | 18 |
| 4765 | Ketab Pols IPD Nilai | 18 |
| 4766 | ALBKES&SUKAN PUPLGKWI | 18 |
| 4767 | sib PoliPO Klang Utara | 18 |
| 4769 | LB POUS IPD LIMBANG | 18 |
| 4770 | KLBPLS PULAPOL SENTOSA | 18 |
| 4771 | PgriP'stn Pddkrmhn lasin | 18 |
| 4772 | PitnPedk Prmhn S.Tmggung | 18 |
| 4775 | Pep Prmhn PORM Muar Inhor | 18 |
| 4776 | /K Prmhe PDRM KotaTingg | 18 |
| 4777 | Pdnan Suah h | 18 |
| 4778 | PPK Prmhe PDRM B | 18 |
| 4779 | BondPoe P Sa | 18 |
| 4782 | Pfletn PikKom Tabuanlaya | 18 |
| 4783 | Pstn Phuni PrsnPois Swk | 18 |
| 4784 | Khshe Prmhn Pol Mor Akar | 18 |
| 4785 | L/K Kbshn Barek IPD KK | 18 |
| 4786 | Thg Komp Tee Nelly Sabah | 18 |
| 4787 | Putn Pddk Ppuri BN15 Sek | 18 |
| 4788 | MESSRS P.PPBN17 PGA | 18 |
| 4789 | Pstuan Prmhn IPD Raub | 18 |
| 4792 | KPermuafkatanPenduduk | 18 |
| 4794 | Bend KlbPolsSekl SAlam | 18 |
| 4800 | Prchn POAM P/Hen K/Trg | 18 |
| 4801 | Tuan/K Prmhn Cangkawi | 18 |
| 4804 | Per Prmhn PRM akt.Cagar | 18 |
| 4805 | Per Penduduk Prmhn Sek 20 | 18 |
| 4806 | Pee Pendudu Dea Badun | 18 |
| 4807 | Per Pghune RhHuuKag | 18 |
| 4808 | Per Penduduk Desa Task | 18 |
| 4809 | Per Penduduk Tame Mha | 18 |
| 4811 | Per Pend Balai Kepong | 18 |
| 4814 | FERUMAHAN HULU TERENGGANU | 18 |
| 4815 | Pers Pend Tme IPO Pontan | 18 |
| 4816 | Bend Surau Pols Selangor | 18 |
| 4817 | Bend Surau PK Melaka | 18 |
| 4818 | Mend Su Pulis Melaka Tgh | 18 |
| 4819 | Surau IPD Alor Gajah | 18 |
| 4820 | Bend Su Pols IPK Nes | 18 |
| 4821 | Bend Surau Polis Seremban | 18 |
| 4822 | Bend Surau Pols Tampin | 18 |
| 4823 | K MdSallenPuLAPOL | 18 |
| 4825 | Rend SuMbPlis KKubuar | 18 |
| 4826 | Pgerusi MdB.Aman PORM | 18 |
| 4827 | Bend 1hga Khkn Agism/Su | 18 |
| 4828 | Surau Pols Mann | 18 |
| 4829 | K Surau IPD Sy | 18 |
| 4831 | Bdn Kbkn Islare BNIS PGA | 18 |
| 4832 | BnAmnh Kbjn sm(aks | 18 |
| 4833 | Myd An NurulHfayah PUt | 18 |
| 4834 | Bn Dnhmht Pg | 18 |
| 4835 | Ibge Dkwh isimeh Kepayan | 18 |
| 4836 | Thg Pstuan islam IPD KK | 18 |
| 4837 | Tabung Surau IK Perak | 18 |
| 4839 | Bendehar SurauIPK Kedah | 18 |
| 4840 | SurauPolisKTeeg | 18 |
| 4841 | u Polis Kplks P.Hn K.T | 18 |
| 4842 | Surau Poln Kemaman | 18 |
| 4843 | Surau Pols Marang | 18 |
| 4844 | Surau Pols Setiu | 18 |
| 4845 | Surau Pals Hulu Tgats | 18 |
| 4848 | YDptuan Su Pois Dungun | 18 |
| 4849 | Bend Msid lamel Depoh IB | 18 |
| 4850 | Surau FRU 2 Palis Depoh | 15 |
| 4851 | Surau tohor Babru Utara | 18 |
| 4864 | Bend. Madrasah Toiyyibah | 18 |
| 4865 | Surau Ehsaniah PSP | 15 |
| 4866 | Surau Ar Rahman | 18 |
| 4867 | Surau AI-thsan Shah Alam | 18 |
| 4868 | Surau Al-Aman PD Sentu | 18 |
| 4869 | Surau Al-mah PUPLGKWI | 18 |
| 4870 | SW Rmh/Pvbt 8.NrgPerak | 15 |
| 4878 | Surau Cawangan IPK KL | 18 |
| 4879 | SW Rmh/Prbt B.Nog.Perak | 18 |
| 4880 | SW RmhyPvbe BNeg Srwk | 18 |
| 4886 | Ams. Rmh Math Pmint K.Trg | 18 |
| 4890 | SW Reh/Prbt B.Neg Srwk | 15 |
| 4894 | Ans. Rmh Mth Sarowak | 15 |
| 4898 | Zakat Pst Zkt Labuan | 15 |
| 4899 | Ibg Khairat POL Johor | 15 |
| 4900 | Tbg Khairat POe Kolantan | 15 |
| 4901 | Thy Shoirat PO Selangor | 15 |
| 4902 | Tibg Khaerat POL Pahang | 15 |
| 4903 | Tbg Khairat POt Perak | 18 |
| 4904 | Thg Khairat POt Selangr | 18 |
| 4906 | Mess POL Perak | 15 |
| 4907 | Thg Khairat POL Sebah | 18 |
| 4908 | Thg Khairat POL PULAPOL | 18 |
| 4911 | Thg Khairat PPt Langkawt | 15 |
| 4912 | Baituinal Perak | 15 |
| 4915 | BestuimalKelantan | 15 |
| 4918 | Bastuimal P.Pinang | 15 |
| 4919 | Baituimal Pahang | 15 |
| 4926 | Tbg Pmbgn Maspid Johor | 15 |
| 4939 | TKS Sosial lohor | 15 |
| 4940 | TKS Sosial Kedah | 15 |
| 4941 | TKes Sosial Kelantan | 18 |
| 4942 | TKs Sosial Melaka | 18 |
| 4943 | TKS Sosial N Sembilan | 18 |
| 4944 | TKS Sosial Pahang | 15 |
| 4945 | TIKS Sosial P.Pinang | 18 |
| 4946 | TKS Sosial Perak | 18 |
| 4947 | TKs Sosial Selangor | 18 |
| 4948 | TKS Sosal Terengganu | 18 |
| 4949 | TKS Sosial K.Laugaar | 18 |
| 4950 | TKS Sosial Sabah | 15 |
| 4951 | Trs Sosial Saramak | 15 |
| 4952 | TKS Sovial fiukit Aman | 15 |
| 4953 | TKSSOSial PULAPOL Kch | 18 |
| 4954 | TKS Sosial BDE Tengah | 18 |
| 4955 | TKS Sosial BDE Tenggara | 18 |
| 4956 | TKS Sesal BDE Sawk | 18 |
| 4957 | TKS Soval BDE Sabah | 15 |
| 4958 | Tes Sosial Perlis | 18 |
| 4962 | Pug TKSS Melake | 15 |
| 4965 | Piny TKSS P. Pinang | 15 |
| 4966 | Pinj TKSS Perak | 15 |
| 4971 | Pinj TKSS Sarawak | 15 |
| 4973 | Ping TKSS PULAPOL Kch | 15 |
| 4976 | Pinj TKSS BDE Sarawak | 15 |
| 4977 | Pinj TKSS RDE Sabah | 15 |
| 4979 | Meu POL Kelartan | 18 |
| 4982 | Mess POL P.Pmarg | 18 |
| 4983 | Mess POL Kelantan | 15 |
| 4985 | Mess POLP.Paang | 15 |
| 4986 | Mess POL Perak | 18 |
| 4988 | Mess POL Terengganu | 15 |
| 4989 | Mess POL K Lumpur | 15 |
| 4990 | Mess POL Sabah | 15 |
| 4991 | Mess POL Sarawak | 15 |
| 4992 | Mess POL Bukt Aoman | 15 |
| 4993 | Mess POL PULAPOLEL | 15 |
| 4995 | Mess POL PULAPOL Kuching | 16 |
| 5001 | Mess POL Perlis | 7 |
| 5007 | Png Api & Ar Pahang | 7 |
| 5015 | Prg Api & Ao Bukat Aman | 7 |
| 5016 | Berd PPPsA | 7 |
| 5019 | Ptg Ap& Ae BDE Teg | 7 |
| 5040 | Hitg Mes Peg Knn Polis BA | 7 |
| 5041 | Tbe Peg Kanan PDRM | 7 |
| 5042 | Thg Kebaikan PDRM | 7 |
| 5046 | PPRPD | 7 |
| 5048 | SPOCSU | 7 |
| 5051 | SPACSU | 7 |
| 5052 | The Guaman PDRM | 7 |
| 5053 | Por Sgl Simgn BSN | 7 |
| 5057 | PACSU | 7 |
| 5061 | Takalul khlas | 7 |
| 5066 | Pingaman Penbudi MARA | 7 |
| 5070 | Potongan KKS PORM | 7 |
| 5073 | Kelab Team KBS | 7 |
| 5074 | S/WRmh Prdn aan PORM | 7 |
| 5078 | Faung WagafRakyat lor | 7 |
| 5080 | KOOP PORM (Yuran) | 7 |
| 5081 | KOPEKS (Insurans) | 7 |
| 5082 | KOOP TENTERA (INR) | 7 |
| 5083 | KOOP PORM PENANGINN) | 7 |
| 5084 | PgninT) | 7 |
| 5085 | SyktTakafulMSu5.8.[2] | 7 |
| 5092 | Fakaful likhlas (2) | 7 |
| 5095 | KOPEKS (Insurans) (2) | 7 |
| 5097 | KOOPPORMPNG(IU(2) | 7 |
| 5100 | Conp-PegMelyo M2) | 7 |
| 5102 | KopPekergakjnatahBd(2) | 7 |
| 5103 | Coop-Fed Armed Focs (2) | 7 |
| 5104 | Coop-Sy KopFolks P Pg(2) | 7 |
| 5105 | Kap BersekutuP Png Bhd(2) | 7 |
| 5106 | Perama (2) | 7 |
| 5107 | Papaman Peribad BSN (2) | 7 |
| 5108 | A/K Prablayaan Risda (2) | 7 |
| 5109 | SabahCreitCopoation(2 | 7 |
| 5110 | M'sia Bifg Soc Bhd (2) | 7 |
| 5111 | Yayasan thsan Rakyat (2) | 7 |
| 5112 | I Destinasi Sdn Shd (2) | 7 |
| 5113 | CoshareHoldigs Bed | 7 |
| 5114 | Ser Wang Enterprise (2) | 7 |
| 5115 | Kelab KehajkanSukan KSM | 7 |
| 5116 | LTAT | 7 |
| 5117 | Mgs Shn Khk & Ris KM | 8 |
| 5800 | Pend Komp Ang Perih Am | 8 |
| 5801 | PondKendoraan | 8 |
| 5805 | 1PdBayTerlethEmolumen | 8 |
| 5807 | Pd-BayTerlebiEmo | 8 |
| 5808 | 4 Pd-BayTerlebch Emolumen | 8 |
| 5810 | Pd-Kehlangan Wang Awam | 8 |
| 5815 | Pd-Tunggakan Caruman Rwsp | 8 |
| 5819 | 1 Pd-Eil Hos Bg K/T Kjaan | 8 |
| 5820 | 2-Pd-BlHosB /T Kaan | 8 |
| 5830 | Lain-dan Mksd Pend Da | 8 |
| 6000 | 1-Rwtn Perubatan | 7 |
| 6001 | 2-Rwtn Perubatan | 7 |
| 6002 | 3-Rhato Perubutan | 7 |
| 6010 | 1 Achn Pn N/Mm | 7 |
| 6011 | 2.An Pn N/Mm | 7 |
| 6012 | 1.Achn Ptgn Na/Mmah | 7 |
| 6013 | 4-An Pn ymah | 7 |
| 6014 | SAehnPn Na/Mmah | 7 |
| 6015 | 6-ArnPn / | 7 |
| 6017 | -Ann | 7 |
| 6018 | ArhnPgn Nh | 7 |
| 6019 | 10ArhePtgNa/M | 7 |
| 6025 | Angkasa | 7 |
| 6026 | Angkoca (Buln PINAMAN) | 7 |
| 6027 | ANGKASA (insurans) | 7 |
| 6028 | ANGKASA (Insurans) (2) | 7 |
| 6029 | Angkasa (2) | 7 |
| 6030 | Amanah Saa Nol B | 7 |
| 6031 | Lembaga Tabung Hai | 7 |
| 6032 | Penerima Bayaran | 7 |
| 6033 | Ptgn KWSP P Bayaran (P) | 7 |
| 6034 | Ptgn KWSP P.Bayaan (M) | 7 |

