#!/usr/bin/env python3
"""Apply the idempotent Phase 5 privacy-scan copy migration to all 21 locales."""

import argparse
import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "public" / "translations.json"

# eyebrow, heading, intro, scan, findings, raw matches, cleanup heading,
# remove metadata, signature warning, limits heading, open CTA
CORE = {
 "es": ("Inspección local", "Comprueba riesgos de privacidad detectables en PDF", "Inspecciona estructuras PDF detectables y patrones de texto sin subir archivos, abrir enlaces ni ejecutar scripts.", "Analizar riesgos detectables", "Hallazgos detectables", "Mostrar coincidencias sensibles sin procesar", "Limpieza verificada opcional", "Eliminar metadatos estándar del documento", "Se detecta un campo de firma. Reescribir el PDF puede invalidar una firma digital existente.", "Límites importantes", "Abrir análisis de privacidad"),
 "fr": ("Inspection locale", "Vérifier les risques de confidentialité détectables d’un PDF", "Inspectez les structures PDF détectables et les motifs de texte sans téléverser, ouvrir de liens ni exécuter de scripts.", "Analyser les risques détectables", "Éléments détectables", "Afficher les correspondances sensibles brutes", "Nettoyage vérifié facultatif", "Supprimer les métadonnées standard du document", "Un champ de signature est détectable. Réécrire le PDF peut invalider une signature numérique existante.", "Limites importantes", "Ouvrir l’analyse de confidentialité"),
 "de": ("Lokale Prüfung", "Erkennbare PDF-Datenschutzrisiken prüfen", "Prüfen Sie erkennbare PDF-Strukturen und Textmuster, ohne Dateien hochzuladen, Links zu öffnen oder Skripte auszuführen.", "Erkennbare Risiken scannen", "Erkennbare Funde", "Rohe sensible Treffer anzeigen", "Optionale verifizierte Bereinigung", "Standard-Dokumentmetadaten entfernen", "Ein Signaturfeld wurde erkannt. Das Neuschreiben der PDF kann eine vorhandene digitale Signatur ungültig machen.", "Wichtige Grenzen", "Datenschutzprüfung öffnen"),
 "pt": ("Inspeção local", "Verificar riscos de privacidade detectáveis no PDF", "Inspecione estruturas PDF detectáveis e padrões de texto sem enviar arquivos, abrir links ou executar scripts.", "Verificar riscos detectáveis", "Achados detectáveis", "Mostrar correspondências sensíveis brutas", "Limpeza verificada opcional", "Remover metadados padrão do documento", "Foi detectado um campo de assinatura. Regravar o PDF pode invalidar uma assinatura digital existente.", "Limites importantes", "Abrir verificação de privacidade"),
 "it": ("Ispezione locale", "Controlla i rischi di privacy rilevabili nel PDF", "Esamina strutture PDF rilevabili e schemi di testo senza caricare file, aprire link o eseguire script.", "Scansiona i rischi rilevabili", "Risultati rilevabili", "Mostra corrispondenze sensibili non elaborate", "Pulizia verificata facoltativa", "Rimuovi i metadati standard del documento", "È rilevabile un campo firma. La riscrittura del PDF può invalidare una firma digitale esistente.", "Limiti importanti", "Apri scansione privacy"),
 "ru": ("Локальная проверка", "Проверить обнаруживаемые риски конфиденциальности PDF", "Проверьте обнаруживаемые структуры PDF и текстовые шаблоны без загрузки файла, открытия ссылок и запуска скриптов.", "Проверить обнаруживаемые риски", "Обнаруживаемые находки", "Показать исходные конфиденциальные совпадения", "Необязательная проверенная очистка", "Удалить стандартные метаданные документа", "Обнаружено поле подписи. Перезапись PDF может сделать существующую цифровую подпись недействительной.", "Важные ограничения", "Открыть проверку конфиденциальности"),
 "ja": ("ローカル検査", "検出可能な PDF のプライバシーリスクを確認", "アップロード、リンクのオープン、スクリプトの実行をせずに、検出可能な PDF 構造と文書テキストのパターンを調べます。", "検出可能なリスクをスキャン", "検出可能な項目", "機密パターンの一致内容を表示", "任意の検証済みクリーンアップ", "標準文書メタデータを削除", "署名フィールドが検出されました。PDF の書き直しにより既存のデジタル署名が無効になる場合があります。", "重要な制限", "プライバシースキャンを開く"),
 "ko": ("로컬 검사", "감지 가능한 PDF 개인정보 위험 확인", "파일 업로드, 링크 열기 또는 스크립트 실행 없이 감지 가능한 PDF 구조와 문서 텍스트 패턴을 검사합니다.", "감지 가능한 위험 검사", "감지 가능한 결과", "민감한 패턴의 원문 일치 항목 표시", "선택적 검증 정리", "표준 문서 메타데이터 제거", "서명 필드가 감지되었습니다. PDF를 다시 쓰면 기존 디지털 서명이 무효화될 수 있습니다.", "중요한 제한", "개인정보 검사 열기"),
 "zh": ("本地检查", "检查可检测的 PDF 隐私风险", "无需上传文件、打开链接或运行脚本，即可检查可检测的 PDF 结构和文档文本模式。", "扫描可检测风险", "可检测结果", "显示敏感模式原始匹配", "可选的验证清理", "删除标准文档元数据", "检测到签名字段。重写 PDF 可能会使现有数字签名失效。", "重要限制", "打开隐私扫描"),
 "zh-TW": ("本機檢查", "檢查可偵測的 PDF 隱私風險", "無需上傳檔案、開啟連結或執行指令碼，即可檢查可偵測的 PDF 結構與文件文字模式。", "掃描可偵測風險", "可偵測結果", "顯示敏感模式原始相符項目", "選用的已驗證清理", "移除標準文件中繼資料", "偵測到簽章欄位。重寫 PDF 可能使現有數位簽章失效。", "重要限制", "開啟隱私掃描"),
 "ar": ("فحص محلي", "تحقق من مخاطر الخصوصية القابلة للكشف في PDF", "افحص بنى PDF القابلة للكشف وأنماط نص المستند من دون رفع الملف أو فتح الروابط أو تشغيل البرامج النصية.", "فحص المخاطر القابلة للكشف", "النتائج القابلة للكشف", "إظهار التطابقات الحساسة الأولية", "تنظيف اختياري تم التحقق منه", "إزالة بيانات المستند الوصفية القياسية", "تم اكتشاف حقل توقيع. قد تؤدي إعادة كتابة PDF إلى إبطال توقيع رقمي موجود.", "قيود مهمة", "فتح فحص الخصوصية"),
 "hi": ("स्थानीय जाँच", "पता लगाए जा सकने वाले PDF गोपनीयता जोखिम जाँचें", "फ़ाइल अपलोड, लिंक खोले या स्क्रिप्ट चलाए बिना पता लगाने योग्य PDF संरचनाओं और दस्तावेज़-पाठ पैटर्न की जाँच करें।", "पता लगाने योग्य जोखिम स्कैन करें", "पता लगाने योग्य निष्कर्ष", "संवेदनशील पैटर्न के मूल मिलान दिखाएँ", "वैकल्पिक सत्यापित सफ़ाई", "मानक दस्तावेज़ मेटाडेटा हटाएँ", "हस्ताक्षर फ़ील्ड मिला है। PDF को दोबारा लिखने से मौजूदा डिजिटल हस्ताक्षर अमान्य हो सकता है।", "महत्वपूर्ण सीमाएँ", "गोपनीयता स्कैन खोलें"),
 "tr": ("Yerel inceleme", "Algılanabilir PDF gizlilik risklerini denetleyin", "Dosya yüklemeden, bağlantı açmadan veya betik çalıştırmadan algılanabilir PDF yapılarını ve belge metni kalıplarını inceleyin.", "Algılanabilir riskleri tara", "Algılanabilir bulgular", "Ham hassas kalıp eşleşmelerini göster", "İsteğe bağlı doğrulanmış temizleme", "Standart belge meta verilerini kaldır", "Bir imza alanı algılandı. PDF'yi yeniden yazmak mevcut dijital imzayı geçersiz kılabilir.", "Önemli sınırlar", "Gizlilik taramasını aç"),
 "nl": ("Lokale inspectie", "Controleer detecteerbare PDF-privacyrisico's", "Inspecteer detecteerbare PDF-structuren en documenttekstpatronen zonder bestanden te uploaden, links te openen of scripts uit te voeren.", "Detecteerbare risico's scannen", "Detecteerbare bevindingen", "Ruwe gevoelige overeenkomsten tonen", "Optionele geverifieerde opschoning", "Standaard documentmetadata verwijderen", "Er is een handtekeningveld gedetecteerd. Het herschrijven van de PDF kan een bestaande digitale handtekening ongeldig maken.", "Belangrijke beperkingen", "Privacyscan openen"),
 "pl": ("Kontrola lokalna", "Sprawdź wykrywalne zagrożenia prywatności w PDF", "Sprawdź wykrywalne struktury PDF i wzorce tekstu dokumentu bez przesyłania pliku, otwierania łączy ani uruchamiania skryptów.", "Skanuj wykrywalne zagrożenia", "Wykrywalne wyniki", "Pokaż surowe dopasowania poufnych wzorców", "Opcjonalne zweryfikowane czyszczenie", "Usuń standardowe metadane dokumentu", "Wykryto pole podpisu. Ponowne zapisanie PDF może unieważnić istniejący podpis cyfrowy.", "Ważne ograniczenia", "Otwórz skan prywatności"),
 "id": ("Pemeriksaan lokal", "Periksa risiko privasi PDF yang dapat dideteksi", "Periksa struktur PDF dan pola teks dokumen yang dapat dideteksi tanpa mengunggah file, membuka tautan, atau menjalankan skrip.", "Pindai risiko yang dapat dideteksi", "Temuan yang dapat dideteksi", "Tampilkan kecocokan sensitif mentah", "Pembersihan terverifikasi opsional", "Hapus metadata dokumen standar", "Bidang tanda tangan terdeteksi. Menulis ulang PDF dapat membatalkan tanda tangan digital yang ada.", "Batasan penting", "Buka pemindaian privasi"),
 "vi": ("Kiểm tra cục bộ", "Kiểm tra rủi ro riêng tư có thể phát hiện trong PDF", "Kiểm tra cấu trúc PDF và mẫu văn bản có thể phát hiện mà không tải tệp lên, mở liên kết hay chạy tập lệnh.", "Quét rủi ro có thể phát hiện", "Phát hiện có thể nhận biết", "Hiện kết quả khớp nhạy cảm thô", "Dọn dẹp tùy chọn đã xác minh", "Xóa siêu dữ liệu tài liệu tiêu chuẩn", "Đã phát hiện trường chữ ký. Việc ghi lại PDF có thể làm mất hiệu lực chữ ký số hiện có.", "Giới hạn quan trọng", "Mở quét quyền riêng tư"),
 "th": ("การตรวจสอบในเครื่อง", "ตรวจสอบความเสี่ยงด้านความเป็นส่วนตัวของ PDF ที่ตรวจจับได้", "ตรวจสอบโครงสร้าง PDF และรูปแบบข้อความที่ตรวจจับได้โดยไม่อัปโหลดไฟล์ เปิดลิงก์ หรือเรียกใช้สคริปต์", "สแกนความเสี่ยงที่ตรวจจับได้", "ผลที่ตรวจจับได้", "แสดงข้อความตรงกันที่ละเอียดอ่อนแบบดิบ", "การล้างที่ตรวจสอบแล้วซึ่งเลือกได้", "ลบข้อมูลเมตาของเอกสารมาตรฐาน", "ตรวจพบช่องลายเซ็น การเขียน PDF ใหม่อาจทำให้ลายเซ็นดิจิทัลเดิมใช้ไม่ได้", "ข้อจำกัดสำคัญ", "เปิดการสแกนความเป็นส่วนตัว"),
 "uk": ("Локальна перевірка", "Перевірити виявлювані ризики приватності PDF", "Перевірте виявлювані структури PDF і шаблони тексту документа без завантаження файлу, відкриття посилань чи виконання скриптів.", "Сканувати виявлювані ризики", "Виявлювані знахідки", "Показати необроблені конфіденційні збіги", "Необов’язкове перевірене очищення", "Видалити стандартні метадані документа", "Виявлено поле підпису. Перезапис PDF може зробити наявний цифровий підпис недійсним.", "Важливі обмеження", "Відкрити перевірку приватності"),
 "cs": ("Místní kontrola", "Zkontrolovat zjistitelná rizika soukromí v PDF", "Zkontrolujte zjistitelné struktury PDF a vzory textu dokumentu bez nahrání souboru, otevření odkazů nebo spuštění skriptů.", "Skenovat zjistitelná rizika", "Zjistitelné nálezy", "Zobrazit nezpracované citlivé shody", "Volitelné ověřené vyčištění", "Odstranit standardní metadata dokumentu", "Bylo zjištěno pole podpisu. Přepsání PDF může zneplatnit existující digitální podpis.", "Důležitá omezení", "Otevřít kontrolu soukromí"),
 "sv": ("Lokal granskning", "Kontrollera upptäckbara integritetsrisker i PDF", "Granska upptäckbara PDF-strukturer och dokumenttextmönster utan att ladda upp filer, öppna länkar eller köra skript.", "Skanna upptäckbara risker", "Upptäckbara fynd", "Visa råa känsliga träffar", "Valfri verifierad rensning", "Ta bort standardmetadata för dokumentet", "Ett signaturfält upptäcktes. Omskrivning av PDF-filen kan ogiltigförklara en befintlig digital signatur.", "Viktiga begränsningar", "Öppna integritetsskanning"),
}

CATEGORIES = {
 "es": "Metadatos estándar|Metadatos XMP|Adjuntos del catálogo|Adjuntos de página|Anotaciones|Enlaces y acciones|JavaScript del documento|JavaScript de página|Campos de formulario|Orden de cálculo|Campos de firma|Texto invisible detectable|Patrones de texto sensible",
 "fr": "Métadonnées standard|Métadonnées XMP|Pièces jointes du catalogue|Pièces jointes de page|Annotations|Liens et actions|JavaScript du document|JavaScript de page|Champs de formulaire|Ordre de calcul|Champs de signature|Texte invisible détectable|Motifs de texte sensible",
 "de": "Standardmetadaten|XMP-Metadaten|Kataloganhänge|Seitenanhänge|Anmerkungen|Links und Aktionen|Dokument-JavaScript|Seiten-JavaScript|Formularfelder|Berechnungsreihenfolge|Signaturfelder|Erkennbarer unsichtbarer Text|Sensible Textmuster",
 "pt": "Metadados padrão|Metadados XMP|Anexos do catálogo|Anexos da página|Anotações|Links e ações|JavaScript do documento|JavaScript da página|Campos de formulário|Ordem de cálculo|Campos de assinatura|Texto invisível detectável|Padrões de texto sensível",
 "it": "Metadati standard|Metadati XMP|Allegati del catalogo|Allegati di pagina|Annotazioni|Link e azioni|JavaScript del documento|JavaScript di pagina|Campi modulo|Ordine di calcolo|Campi firma|Testo invisibile rilevabile|Schemi di testo sensibile",
 "ru": "Стандартные метаданные|Метаданные XMP|Вложения каталога|Вложения страниц|Аннотации|Ссылки и действия|JavaScript документа|JavaScript страницы|Поля формы|Порядок вычислений|Поля подписи|Обнаруживаемый невидимый текст|Шаблоны конфиденциального текста",
 "ja": "標準メタデータ|XMP メタデータ|カタログ添付|ページ添付|注釈|リンクとアクション|文書 JavaScript|ページ JavaScript|フォームフィールド|計算順序|署名フィールド|検出可能な非表示テキスト|機密テキストパターン",
 "ko": "표준 메타데이터|XMP 메타데이터|카탈로그 첨부 파일|페이지 첨부 파일|주석|링크 및 작업|문서 JavaScript|페이지 JavaScript|양식 필드|계산 순서|서명 필드|감지 가능한 숨김 텍스트|민감한 텍스트 패턴",
 "zh": "标准元数据|XMP 元数据|目录附件|页面附件|注释|链接和操作|文档 JavaScript|页面 JavaScript|表单字段|计算顺序|签名字段|可检测的不可见文本|敏感文本模式",
 "zh-TW": "標準中繼資料|XMP 中繼資料|目錄附件|頁面附件|註解|連結與動作|文件 JavaScript|頁面 JavaScript|表單欄位|計算順序|簽章欄位|可偵測的隱藏文字|敏感文字模式",
 "ar": "بيانات وصفية قياسية|بيانات XMP الوصفية|مرفقات الكتالوج|مرفقات الصفحة|تعليقات توضيحية|روابط وإجراءات|JavaScript المستند|JavaScript الصفحة|حقول النموذج|ترتيب الحساب|حقول التوقيع|نص مخفي قابل للكشف|أنماط نص حساس",
 "hi": "मानक मेटाडेटा|XMP मेटाडेटा|कैटलॉग अटैचमेंट|पेज अटैचमेंट|एनोटेशन|लिंक और क्रियाएँ|दस्तावेज़ JavaScript|पेज JavaScript|फ़ॉर्म फ़ील्ड|गणना क्रम|हस्ताक्षर फ़ील्ड|पता लगाने योग्य अदृश्य टेक्स्ट|संवेदनशील टेक्स्ट पैटर्न",
 "tr": "Standart meta veriler|XMP meta verileri|Katalog ekleri|Sayfa ekleri|Ek açıklamalar|Bağlantılar ve eylemler|Belge JavaScript'i|Sayfa JavaScript'i|Form alanları|Hesaplama sırası|İmza alanları|Algılanabilir görünmez metin|Hassas metin kalıpları",
 "nl": "Standaardmetadata|XMP-metadata|Catalogusbijlagen|Paginabijlagen|Annotaties|Links en acties|Document-JavaScript|Pagina-JavaScript|Formuliervelden|Berekeningsvolgorde|Handtekeningvelden|Detecteerbare onzichtbare tekst|Gevoelige tekstpatronen",
 "pl": "Standardowe metadane|Metadane XMP|Załączniki katalogu|Załączniki stron|Adnotacje|Łącza i akcje|JavaScript dokumentu|JavaScript strony|Pola formularza|Kolejność obliczeń|Pola podpisu|Wykrywalny niewidoczny tekst|Wzorce poufnego tekstu",
 "id": "Metadata standar|Metadata XMP|Lampiran katalog|Lampiran halaman|Anotasi|Tautan dan tindakan|JavaScript dokumen|JavaScript halaman|Kolom formulir|Urutan perhitungan|Kolom tanda tangan|Teks tak terlihat yang terdeteksi|Pola teks sensitif",
 "vi": "Siêu dữ liệu tiêu chuẩn|Siêu dữ liệu XMP|Tệp đính kèm danh mục|Tệp đính kèm trang|Chú thích|Liên kết và hành động|JavaScript tài liệu|JavaScript trang|Trường biểu mẫu|Thứ tự tính toán|Trường chữ ký|Văn bản ẩn có thể phát hiện|Mẫu văn bản nhạy cảm",
 "th": "ข้อมูลเมตามาตรฐาน|ข้อมูลเมตา XMP|ไฟล์แนบแค็ตตาล็อก|ไฟล์แนบหน้า|คำอธิบายประกอบ|ลิงก์และการทำงาน|JavaScript ของเอกสาร|JavaScript ของหน้า|ช่องแบบฟอร์ม|ลำดับการคำนวณ|ช่องลายเซ็น|ข้อความที่ซ่อนซึ่งตรวจจับได้|รูปแบบข้อความที่ละเอียดอ่อน",
 "uk": "Стандартні метадані|Метадані XMP|Вкладення каталогу|Вкладення сторінок|Анотації|Посилання та дії|JavaScript документа|JavaScript сторінки|Поля форми|Порядок обчислень|Поля підпису|Виявлюваний невидимий текст|Шаблони конфіденційного тексту",
 "cs": "Standardní metadata|Metadata XMP|Přílohy katalogu|Přílohy stránek|Anotace|Odkazy a akce|JavaScript dokumentu|JavaScript stránky|Pole formuláře|Pořadí výpočtu|Pole podpisu|Zjistitelný neviditelný text|Vzory citlivého textu",
 "sv": "Standardmetadata|XMP-metadata|Katalogbilagor|Sidbilagor|Anteckningar|Länkar och åtgärder|Dokument-JavaScript|Sid-JavaScript|Formulärfält|Beräkningsordning|Signaturfält|Upptäckbar osynlig text|Känsliga textmönster",
}

SENSITIVE = {
 "es":"Correo electrónico|Patrón de número de Seguridad Social de EE. UU.|Patrón de tarjeta de pago|Patrón de teléfono", "fr":"Adresse e-mail|Motif de numéro de sécurité sociale américain|Motif de carte de paiement|Motif de téléphone", "de":"E-Mail-Adresse|Muster einer US-Sozialversicherungsnummer|Zahlungskartenmuster|Telefonnummernmuster", "pt":"Endereço de e-mail|Padrão de número de Segurança Social dos EUA|Padrão de cartão de pagamento|Padrão de telefone", "it":"Indirizzo e-mail|Schema del numero di previdenza sociale USA|Schema della carta di pagamento|Schema telefonico", "ru":"Адрес электронной почты|Шаблон номера социального страхования США|Шаблон платёжной карты|Шаблон телефона", "ja":"メールアドレス|米国社会保障番号のパターン|支払いカード番号のパターン|電話番号のパターン", "ko":"이메일 주소|미국 사회보장번호 패턴|결제 카드 번호 패턴|전화번호 패턴", "zh":"电子邮件地址|美国社会安全号码模式|支付卡号码模式|电话号码模式", "zh-TW":"電子郵件地址|美國社會安全號碼模式|支付卡號碼模式|電話號碼模式", "ar":"عنوان بريد إلكتروني|نمط رقم الضمان الاجتماعي الأمريكي|نمط بطاقة دفع|نمط رقم هاتف", "hi":"ईमेल पता|अमेरिकी सामाजिक सुरक्षा संख्या पैटर्न|भुगतान कार्ड संख्या पैटर्न|फ़ोन संख्या पैटर्न", "tr":"E-posta adresi|ABD Sosyal Güvenlik numarası kalıbı|Ödeme kartı numarası kalıbı|Telefon numarası kalıbı", "nl":"E-mailadres|Patroon voor Amerikaans burgerservicenummer|Betaalkaartnummerpatroon|Telefoonnummerpatroon", "pl":"Adres e-mail|Wzorzec amerykańskiego numeru ubezpieczenia społecznego|Wzorzec numeru karty płatniczej|Wzorzec numeru telefonu", "id":"Alamat email|Pola nomor Jaminan Sosial AS|Pola nomor kartu pembayaran|Pola nomor telepon", "vi":"Địa chỉ email|Mẫu số an sinh xã hội Hoa Kỳ|Mẫu số thẻ thanh toán|Mẫu số điện thoại", "th":"ที่อยู่อีเมล|รูปแบบหมายเลขประกันสังคมสหรัฐฯ|รูปแบบหมายเลขบัตรชำระเงิน|รูปแบบหมายเลขโทรศัพท์", "uk":"Адреса електронної пошти|Шаблон номера соціального страхування США|Шаблон платіжної картки|Шаблон номера телефону", "cs":"E-mailová adresa|Vzor amerického čísla sociálního zabezpečení|Vzor čísla platební karty|Vzor telefonního čísla", "sv":"E-postadress|Mönster för amerikanskt personnummer|Mönster för betalkortsnummer|Mönster för telefonnummer",
}

CATEGORY_KEYS = ["standardMetadata", "xmp", "catalogAttachments", "pageAttachments", "annotations", "linksAndActions", "documentJavaScript", "pageJavaScript", "forms", "calculationOrder", "signatureFields", "invisibleTextOperations", "sensitivePatterns"]

def migrate(language, locale, core, category_text):
    eyebrow, h1, intro, scan, results, raw, cleanup_title, cleanup_metadata, signature, limits_title, open_cta = core
    categories = category_text.split("|")
    if len(categories) != len(CATEGORY_KEYS): raise ValueError("Incomplete Phase 5 categories")
    values = {
      "hub.privacy_scan_title": h1, "hub.privacy_scan_desc": intro, "hub.open_privacy_scan": open_cta,
      "privacy_scan.eyebrow": eyebrow, "privacy_scan.h1": h1, "privacy_scan.intro": intro,
      "privacy_scan.proof": locale["common.privacy_note"],
      "privacy_scan.choose": locale["workflows.add_files"], "privacy_scan.drop_aria": locale["workflows.drop_aria"],
      "privacy_scan.drop_title": locale["workflows.drop_title"], "privacy_scan.drop_help": locale["common.privacy_note"],
      "privacy_scan.scan": scan, "privacy_scan.results": results, "privacy_scan.raw_matches": raw,
      "privacy_scan.raw_warning": locale["common.privacy_note"], "privacy_scan.cleanup_title": cleanup_title,
      "privacy_scan.cleanup_metadata": cleanup_metadata,
      "privacy_scan.cleanup_loss": locale["workflows.step_metadata_cleanup_v1_loss"],
      "privacy_scan.signature_warning": signature, "privacy_scan.cleanup": cleanup_metadata,
      "privacy_scan.ready": cleanup_title, "privacy_scan.download": locale["workflows.download"],
      "privacy_scan.limits_title": limits_title, "privacy_scan.limits": intro + " " + locale["workflows.scope_body"],
      "privacy_scan.footer": locale["common.privacy_note"], "privacy_scan.summary": results + ": {n} / {pages}",
      "privacy_scan.no_findings": results + ": 0", "privacy_scan.page": locale["images.js_page_label"],
      "privacy_scan.loading": locale["common.preparing"], "privacy_scan.scanning_page": scan + " {page}/{pages}",
      "privacy_scan.too_large": locale["workflows.too_large"], "privacy_scan.failed": results + ": 0",
      "privacy_scan.cleaning": cleanup_metadata, "privacy_scan.removed": cleanup_metadata + ": {n}",
      "privacy_scan.verified": cleanup_title, "privacy_scan.cleanup_failed": cleanup_title + ": 0",
    }
    values.update({f"privacy_scan.category_{key}": value for key, value in zip(CATEGORY_KEYS, categories)})
    values.update({f"privacy_scan.sensitive_{key}": value for key, value in zip(["email", "us-ssn", "payment-card", "phone"], SENSITIVE[language].split("|"))})
    locale.update(values)

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--check", action="store_true"); args = parser.parse_args()
    original = PATH.read_text(encoding="utf-8"); data = json.loads(original)
    if set(data) != set(CORE) or set(data) != set(CATEGORIES) or set(data) != set(SENSITIVE): raise SystemExit("Phase 5 locale map mismatch")
    for language, locale in data.items(): migrate(language, locale, CORE[language], CATEGORIES[language])
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if rendered != original: raise SystemExit("Phase 5 translation migration is not up to date")
    else: PATH.write_text(rendered, encoding="utf-8")

if __name__ == "__main__": main()
