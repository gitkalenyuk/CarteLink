//! Tray texts per UI language (the web UI has its own translations).

/// [open, switcher, quit, tip, background title, background text]
pub const TRAY: [(&str, [&str; 6]); 17] = [
    (
        "uk",
        [
            "Відкрити CarteLink",
            "Перемикач моделей поверх вікон",
            "Вийти",
            "CarteLink — AI-шлюз працює",
            "CarteLink працює у фоні",
            "Шлюз далі працює. Відкрити вікно — клік по значку в треї; вийти — правий клік → «Вийти».",
        ],
    ),
    (
        "en",
        [
            "Open CarteLink",
            "Always-on-top model switcher",
            "Quit",
            "CarteLink — AI gateway is running",
            "CarteLink is running in the background",
            "The gateway keeps running. To open the window, click the tray icon; to exit, right-click → “Quit”.",
        ],
    ),
    (
        "zh",
        [
            "打开 CarteLink",
            "置顶模型切换器",
            "退出",
            "CarteLink — AI 网关运行中",
            "CarteLink 正在后台运行",
            "网关仍在运行。打开窗口 — 单击托盘图标；退出 — 右键单击 → “退出”。",
        ],
    ),
    (
        "hi",
        [
            "CarteLink खोलें",
            "सभी विंडो के ऊपर मॉडल स्विचर",
            "बाहर निकलें",
            "CarteLink — AI गेटवे चल रहा है",
            "CarteLink बैकग्राउंड में चल रहा है",
            "गेटवे चलता रहता है। विंडो खोलने के लिए ट्रे आइकन पर क्लिक करें; बाहर निकलने के लिए राइट-क्लिक → “बाहर निकलें”।",
        ],
    ),
    (
        "es",
        [
            "Abrir CarteLink",
            "Selector de modelos siempre visible",
            "Salir",
            "CarteLink: el gateway de IA está en marcha",
            "CarteLink sigue en segundo plano",
            "El gateway sigue funcionando. Para abrir la ventana, haz clic en el icono de la bandeja del sistema; para salir, clic derecho → «Salir».",
        ],
    ),
    (
        "fr",
        [
            "Ouvrir CarteLink",
            "Sélecteur de modèles au premier plan",
            "Quitter",
            "CarteLink — passerelle IA en marche",
            "CarteLink fonctionne en arrière-plan",
            "La passerelle continue de fonctionner. Ouvrir la fenêtre : clic sur l'icône de la zone de notification ; quitter : clic droit → « Quitter ».",
        ],
    ),
    (
        "ar",
        [
            "فتح CarteLink",
            "مبدّل النماذج فوق النوافذ",
            "خروج",
            "CarteLink — بوابة AI تعمل",
            "CarteLink يعمل في الخلفية",
            "تستمر البوابة في العمل. لفتح النافذة — انقر على الأيقونة في شريط النظام؛ للخروج — نقرة يمنى ← «خروج».",
        ],
    ),
    (
        "bn",
        [
            "CarteLink খুলুন",
            "সব উইন্ডোর উপরে মডেল সুইচার",
            "প্রস্থান",
            "CarteLink — AI গেটওয়ে চলছে",
            "CarteLink ব্যাকগ্রাউন্ডে চলছে",
            "গেটওয়ে চলতে থাকবে। উইন্ডো খুলতে — ট্রেতে আইকনে ক্লিক করুন; প্রস্থান করতে — রাইট-ক্লিক → “প্রস্থান”।",
        ],
    ),
    (
        "pt",
        [
            "Abrir o CarteLink",
            "Seletor de modelos sobre as janelas",
            "Sair",
            "CarteLink — gateway de IA em execução",
            "O CarteLink está rodando em segundo plano",
            "O gateway continua funcionando. Para abrir a janela, clique no ícone na bandeja; para sair, clique direito → “Sair”.",
        ],
    ),
    (
        "ur",
        [
            "CarteLink کھولیں",
            "تمام ونڈوز کے اوپر ماڈل سوئچر",
            "باہر نکلیں",
            "CarteLink — AI گیٹ وے چل رہا ہے",
            "CarteLink پس منظر میں چل رہا ہے",
            "گیٹ وے چلتا رہتا ہے۔ ونڈو کھولنے کے لیے سسٹم ٹرے کے آئیکن پر کلک کریں؛ باہر نکلنے کے لیے رائٹ کلک ← “باہر نکلیں”۔",
        ],
    ),
    (
        "id",
        [
            "Buka CarteLink",
            "Pengalih model di atas jendela",
            "Keluar",
            "CarteLink — gateway AI berjalan",
            "CarteLink berjalan di latar belakang",
            "Gateway tetap berjalan. Buka jendela — klik ikon di baki sistem; keluar — klik kanan → “Keluar”.",
        ],
    ),
    (
        "de",
        [
            "CarteLink öffnen",
            "Modell-Umschalter über allen Fenstern",
            "Beenden",
            "CarteLink – AI-Gateway läuft",
            "CarteLink läuft im Hintergrund",
            "Das Gateway läuft weiter. Fenster öffnen – Klick auf das Symbol im Infobereich; beenden – Rechtsklick → „Beenden“.",
        ],
    ),
    (
        "ja",
        [
            "CarteLink を開く",
            "最前面のモデルスイッチャー",
            "終了",
            "CarteLink — AI ゲートウェイ動作中",
            "CarteLink はバックグラウンドで動作中です",
            "ゲートウェイは動作を続けています。ウィンドウを開くにはトレイのアイコンをクリック、終了するには右クリック →「終了」。",
        ],
    ),
    (
        "tr",
        [
            "CarteLink'i aç",
            "Pencerelerin üstünde model değiştirici",
            "Çıkış",
            "CarteLink — AI ağ geçidi çalışıyor",
            "CarteLink arka planda çalışıyor",
            "Ağ geçidi çalışmaya devam ediyor. Pencereyi açmak için tepsideki simgeye tıkla; çıkmak için sağ tık → \"Çıkış\".",
        ],
    ),
    (
        "ko",
        [
            "CarteLink 열기",
            "항상 위에 표시되는 모델 전환기",
            "종료",
            "CarteLink — AI 게이트웨이 작동 중",
            "CarteLink가 백그라운드에서 실행 중입니다",
            "게이트웨이는 계속 작동합니다. 창을 열려면 트레이 아이콘을 클릭하고, 종료하려면 우클릭 → ‘종료’를 선택하세요.",
        ],
    ),
    (
        "vi",
        [
            "Mở CarteLink",
            "Bộ chuyển mô hình nổi trên cửa sổ",
            "Thoát",
            "CarteLink — cổng AI đang chạy",
            "CarteLink đang chạy nền",
            "Cổng vẫn tiếp tục chạy. Mở cửa sổ — nhấp vào biểu tượng trong khay hệ thống; thoát — nhấp chuột phải → “Thoát”.",
        ],
    ),
    (
        "pl",
        [
            "Otwórz CarteLink",
            "Przełącznik modeli na wierzchu",
            "Zakończ",
            "CarteLink — bramka AI działa",
            "CarteLink działa w tle",
            "Bramka dalej działa. Otwórz okno — kliknij ikonę w zasobniku systemowym; zakończ — prawy klik → „Zakończ”.",
        ],
    ),
];

#[allow(dead_code)] // background texts: kept for a future notification
pub enum T {
    Open = 0,
    Switcher = 1,
    Quit = 2,
    Tip = 3,
    BgTitle = 4,
    BgText = 5,
}

/// The text in `lang`; English for other non-Ukrainian languages without it.
pub fn tr(lang: &str, key: T) -> &'static str {
    let lang = if lang.is_empty() { "uk" } else { lang };
    let i = key as usize;
    TRAY.iter().find(|(l, _)| *l == lang).or_else(|| TRAY.iter().find(|(l, _)| *l == "en")).map(|(_, t)| t[i]).unwrap_or("CarteLink")
}
