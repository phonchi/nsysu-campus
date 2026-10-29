# 步行版圖資候選資料

{
  "buildings": [
    {
      "id": "BI",
      "url": "/data/walkthrough/BI.json",
      "floorCount": 8,
      "roomCandidateCount": 75,
      "namedRoomCount": 39,
      "reviewStatus": "candidate-review-required",
      "detectionCoverage": "partial"
    },
    {
      "id": "CH",
      "url": "/data/walkthrough/CH.json",
      "floorCount": 7,
      "roomCandidateCount": 76,
      "namedRoomCount": 41,
      "reviewStatus": "candidate-review-required",
      "detectionCoverage": "partial"
    },
    {
      "id": "EC",
      "url": "/data/walkthrough/EC.json",
      "floorCount": 11,
      "roomCandidateCount": 165,
      "namedRoomCount": 15,
      "reviewStatus": "candidate-review-required",
      "detectionCoverage": "partial"
    },
    {
      "id": "EN",
      "url": "/data/walkthrough/EN.json",
      "floorCount": 6,
      "roomCandidateCount": 152,
      "namedRoomCount": 30,
      "reviewStatus": "candidate-review-required",
      "detectionCoverage": "partial"
    },
    {
      "id": "EV",
      "url": "/data/walkthrough/EV.json",
      "floorCount": 7,
      "roomCandidateCount": 99,
      "namedRoomCount": 0,
      "reviewStatus": "candidate-review-required",
      "detectionCoverage": "partial"
    },
    {
      "id": "MS",
      "url": "/data/walkthrough/MS.json",
      "floorCount": 7,
      "roomCandidateCount": 97,
      "namedRoomCount": 23,
      "reviewStatus": "candidate-review-required",
      "detectionCoverage": "partial"
    },
    {
      "id": "PH",
      "url": "/data/walkthrough/PH.json",
      "floorCount": 8,
      "roomCandidateCount": 81,
      "namedRoomCount": 41,
      "reviewStatus": "candidate-review-required",
      "detectionCoverage": "partial"
    },
    {
      "id": "SC",
      "url": "/data/walkthrough/SC.json",
      "floorCount": 6,
      "roomCandidateCount": 167,
      "namedRoomCount": 74,
      "reviewStatus": "candidate-review-required",
      "detectionCoverage": "partial"
    }
  ],
  "note": "候選資料，不宣稱建模完整。"
}

來源：現存官方PDF，頁碼與crop皆保存在每層JSON。SC1/2的31個明確房號以人工對圖輪廓取代色塊碎片，另保留3個未編號空間。SC3/4與EN/BI/PH/CH/EC/MS一般樓層由教務彩色圖分層裁切、色塊擷取並以本機Tesseract抽房號候選；B1/RF及EV使用校安向量圖渲染的封閉區域。狹長窗框、踏面等小區域移至regionCandidates，不直接當rooms渲染；廊道候選kind=circulation-candidate。

所有資料detectionCoverage=partial、reviewStatus=candidate-review-required；未完成逐房核對，不可宣稱所有房間可入。門點全部schematic；SC1/2中央樓梯位置沿用已核對資料，其他樓梯尚缺。中庭與挑空holes尚缺，不能把空holes當成沒有中庭的證據。未知房號留空，未檢出的房號只保留點，不捏造房間輪廓。

PDF crop使用原頁點數；像素→building-local變換保存在transform。SC1/2以中央樓梯為共同原點；其他樓層目前只示意置中，未完成跨層註冊。尺度約公尺示意，非測繪。每層保存原圖renderImage與紅色候選輪廓overlay，供逐項覆圖審查。

執行：`python -B tools/build_walkthrough_data.py`；可用`--buildings SC EN`分批。原sources/floors與integrity lock不變；錯掛管理學院及PH/BI合圖問題另輸出source-corrections-proposal.json。

## 全樓層清冊（來源頁碼與裁圖皆已保存）

表中數量為候選，不能當作實際房間總數；complete全部false。SC1/2人工房號輪廓31間、已核對門洞4點，其餘仍待覆圖審查。

|棟別|樓層|來源頁|房間輪廓|有房號|OCR標記|未配對標記|門洞已核對|樓梯候選|
|---|---|---|---:|---:|---:|---:|---:|---:|
|BI|1F|oaa-02Room_COS_2 p1|7|3|3|0|0|2|
|BI|2F|oaa-02Room_COS_2 p1|11|9|10|0|0|3|
|BI|3F|oaa-02Room_COS_2 p1|15|10|14|0|0|4|
|BI|4F|oaa-02Room_COS_2 p1|15|6|10|0|0|2|
|BI|5F|oaa-02Room_COS_2 p1|3|1|5|0|0|2|
|BI|6F|oaa-02Room_COS_2 p1|20|10|12|0|0|2|
|BI|7F|oaa-02Room_COS_2 p1|3|0|0|0|0|2|
|BI|RF|safety-pta_174544_4720186_04268 p8|0|0|0|0|0|0|
|CH|1F|oaa-02Room_COS_4 p1|3|0|4|0|0|2|
|CH|2F|oaa-02Room_COS_4 p1|9|5|7|0|0|3|
|CH|3F|oaa-02Room_COS_4 p1|17|13|13|0|0|3|
|CH|4F|oaa-02Room_COS_4 p1|16|10|12|0|0|2|
|CH|5F|oaa-02Room_COS_4 p1|14|4|10|0|0|2|
|CH|6F|oaa-02Room_COS_4 p1|14|9|11|0|0|2|
|CH|RF|safety-pta_174546_6679834_04269 p4|2|0|0|0|0|0|
|EC|B1|safety-pta_174558_61801_04270 p1|10|0|0|0|0|0|
|EC|1F|oaa-03Room_COE_2 p1|18|5|3|0|0|5|
|EC|2F|oaa-03Room_COE_2 p1|14|3|3|0|0|1|
|EC|3F|oaa-03Room_COE_2 p1|12|1|1|0|0|4|
|EC|4F|oaa-03Room_COE_2 p1|22|0|0|0|0|5|
|EC|5F|oaa-03Room_COE_2 p1|17|0|0|0|0|3|
|EC|6F|oaa-03Room_COE_2 p1|12|2|2|0|0|3|
|EC|7F|oaa-03Room_COE_2 p1|12|3|3|0|0|3|
|EC|8F|oaa-03Room_COE_2 p1|15|1|1|0|0|3|
|EC|9F|oaa-03Room_COE_2 p1|18|2|2|0|0|3|
|EC|RF|safety-pta_174558_61801_04270 p10|16|0|0|0|0|0|
|EN|B1|safety-pta_174547_2531961_04269 p1|30|0|0|0|0|0|
|EN|1F|oaa-03Room_COE_3 p1|20|8|8|0|0|6|
|EN|2F|oaa-03Room_COE_3 p1|24|8|8|0|0|6|
|EN|3F|oaa-03Room_COE_3 p1|14|6|19|0|0|6|
|EN|4F|oaa-03Room_COE_3 p1|50|8|12|0|0|6|
|EN|RF|safety-pta_174547_2531961_04269 p6|9|0|0|0|0|0|
|EV|1F|safety-pta_174548_7958856_04269 p1|12|0|0|0|0|0|
|EV|2F|safety-pta_174548_7958856_04269 p1|17|0|0|0|0|0|
|EV|3F|safety-pta_174548_7958856_04269 p2|21|0|0|0|0|0|
|EV|4F|safety-pta_174548_7958856_04269 p2|19|0|0|0|0|0|
|EV|5F|safety-pta_174548_7958856_04269 p3|14|0|0|0|0|0|
|EV|6F|safety-pta_174548_7958856_04269 p3|13|0|0|0|0|0|
|EV|RF|safety-pta_174548_7958856_04269 p4|1|0|0|0|0|0|
|MS|1F|oaa-03Room_COE_1 p1|12|5|5|0|0|2|
|MS|2F|oaa-03Room_COE_1 p1|11|2|11|1|0|2|
|MS|3F|oaa-03Room_COE_1 p1|23|8|12|0|0|2|
|MS|4F|oaa-03Room_COE_1 p1|21|1|5|0|0|2|
|MS|5F|oaa-03Room_COE_1 p1|14|4|4|0|0|2|
|MS|6F|oaa-03Room_COE_1 p1|13|3|3|0|0|2|
|MS|RF|safety-pta_174545_2241236_04269 p4|2|0|0|0|0|0|
|PH|1F|oaa-02Room_COS_3 p1|8|5|5|0|0|1|
|PH|2F|oaa-02Room_COS_3 p1|14|6|7|1|0|2|
|PH|3F|oaa-02Room_COS_3 p1|11|6|8|0|0|1|
|PH|4F|oaa-02Room_COS_3 p1|11|7|9|1|0|1|
|PH|5F|oaa-02Room_COS_3 p1|10|5|5|0|0|2|
|PH|6F|oaa-02Room_COS_3 p1|11|7|9|0|0|2|
|PH|7F|oaa-02Room_COS_3 p1|12|5|9|0|0|2|
|PH|RF|safety-pta_174544_4720186_04268 p8|3|0|0|0|0|0|
|SC|B1|safety-pta_174543_8048869_04268 p1|44|0|0|0|0|0|
|SC|1F|oaa-02Room_COS_1 p1|13|11|0|0|3|1|
|SC|2F|oaa-02Room_COS_1 p1|21|20|0|0|1|1|
|SC|3F|oaa-02Room_COS_1 p1|28|20|0|4|0|5|
|SC|4F|oaa-02Room_COS_1 p1|36|23|0|8|0|6|
|SC|RF|safety-pta_174543_8048869_04268 p6|16|0|0|0|0|0|

現階段圖資無缺頁不等於模型完整：仍缺跨層同名樓梯配對、屋頂與中庭void核對、室內外入口配準及全部房門；部分小房間可能與窗框過濾一起移入regionCandidates，需人工補回。SC1/2以中央樓梯原點對齊，其他層以圖像中心示意置中，跨層尚未完成註冊。floor.mapAnnotations保留SC1/2既有NavNode與其normalized原值、local值。RF level=99只作屋頂代碼，高度請用storeyIndex。

## SC首區覆圖與最後驗證

SC1/2全部34個命名或未編號空間均有人工作廊側示意門；原先已核對4門不變。SC2005/2004/2003取南側、SC2002群取西側、SC1012及SC1009等取朝向主廊道一側。SC2011依高解析圖東南角可見朝東雙開門選東側，沒有錯放到北側外牆。SC1狹長挑空左界由誤吞廊道的normalized x=.620修正至.631，右界.657，以保留左側實際走廊；此為圖面近似讀值，非現地尺寸。

validation.json記錄輸出JSON雜湊與純幾何檢查；一般房間候選的語意、房門、碰撞可通行性與跨層對位不因多邊形有效而視為通過。

## 八棟跨層註冊與虛擬服務梯

執行 `python -B tools/prepare_campus_interiors.py`；原始輸入保存在alignment-input-各棟.json，重跑不重複套用變換。SC1/2物件逐字典比較保持不變。地上層用同一綠色梯段或EV重複升降機核心作錨點，按主體跨度近似縮放；沒有將圖像置中當成跨層對位。B1/RF無法配準者為schematic。BI合冊RF頁正文只有PH屋頂，因此BI RF改為沿BI7F輪廓的示意屋頂，不是取得生科館屋頂圖。

rooms與circulation已分開；所有新門點/入口及外接服務梯均schematic，不升級map-checked。外接服務梯4.5×5m，足跡在所有房間輪廓外。SC原stairs[0]=[0,0]保持原有區；building.serviceStair提供另設外接梯位置。其他棟stairs[0]各層同一虛擬服務梯，原圖梯段候選另存stairCandidates。serviceConnector是待幾何整合的示意通道，不宣稱真實出入口。

每棟alignment-各棟.json含逐層變換及原圖overlay SVG字串；SVG在原圖像素上標房間紅線、示意門綠點及對位錨點紫十字。59實際來源層＋1示意BI屋頂；room detectionCoverage仍partial。

|棟別|層數|註冊後bounds|共同外接梯anchor|
|---|---:|---|---|
|BI|8|[-36.4919, -17.9676, 15.7448, 10.7023]|[20.245, 0.0]|
|CH|7|[-42.126, -12.4674, 13.7642, 22.0872]|[18.264, 0.0]|
|EC|11|[-49.0585, -25.8201, 35.5165, 26.0581]|[40.017, 0.0]|
|EN|6|[-86.7359, -32.9409, 24.4981, 13.6713]|[28.998, 0.0]|
|EV|7|[-27.312, -8.8262, 19.3301, 16.0268]|[23.83, 0.0]|
|MS|7|[-43.7379, -21.5293, 14.2293, 13.4207]|[18.729, 0.0]|
|PH|8|[-32.1285, -20.7423, 16.2685, 13.6647]|[20.768, 0.0]|
|SC|6|[-88.999, -11.438, 16.127, 27.878]|[20.627, 0.0]|

### 六張問題來源頁的人工語意複核

SC-RF的開放屋頂大區及EN-RF平台改circulation；EN-B1公共大區與原圖可見踏面的樓梯前室、EV5/6F左下梯段上方平台亦改circulation。CH1F-region001是米黃色標題裝飾，並非房間，不擴大outline。EN-B1中央X內院、EN-RF的X空域及SC-RF中央一大三小X矩形補holes；相應三角碎片保留在regionCandidates。此為源圖符號判讀，不宣稱已現地核對目前樓板狀態。逐筆原polygon/source/page與理由見source-review-corrections.json。修正後rendered rooms/room-candidate為895；20個廊道候選另計。SC1/2與全部註冊不變。全樓層最新實數以coverage.json為準；下列舊初版表為歷史候選快照。

### 首層底色混合與真實外凸邊界複核

BI／PH／MS 1F的region001為米黃色標題底色，移到regionCandidates；EC1F的region001是底色與實際粉色房間相連的混合色塊，原塊保留證據，按放大原圖清楚可見的EC1004／EC1005房號及中間分隔牆，另保留兩個人工描繪候選（門仍schematic）。EN3F-region001是真實長房、EN-B1-region021是源圖真實小外凸框，只按這兩個原polygon補回自動outline漏邊，不更改註冊。最新實數893個rendered rooms／room-candidate與20個circulation；coverage.json與alignment-validation.json已同步。其他首層自動輪廓可能仍包含「現在位置」標記箭頭，未在本次有界修正擴大處理。

### RF/B1與代表性門碰撞的來源複核

這輪只依原圖分類，不依coverage刪房。CH-RF002/003為開放屋頂與平台，PH-RF002為梯間平台、004內框無一般房門；EN-RF002是U形屋頂平台。EC-RF001/002與SC-B1-018明確X空域移候選並補holes；SC-B1-003中央梯廳、045疏散箭頭通道、EN-B1-026長梯廳、013窗框外牆細帶、EV3F007中間走廊及東廊、EV1F039外部L平台皆逐圖處理。CH東北兩個可見牆/南側門弧的小屋另保留無房號候選，未猜用途或房號。

EV2F046／EV3F029／EV5F029原圖是X電梯井及門槽，移vertical-service候選，另存floor.verticalServices（不是露天holes）；後續世界及free-space應以封閉電梯構件/不可穿行區表示。SCB1-045原圖是通道而非房間，四個clearance缺口的來源語意均已判明。

未硬刪的證據：EV3F-region028是真矩形房間，約4.01×2.40m，原圖可見牆/門；audit障礙z1.6004位於房間南界z1.377外約0.2234m，應修第二道外輪廓牆/門而非移掉房間。EV3F014為帶衛浴隔間的真圍合空間。MS-RF003混合長廊及有界設備區，需拆分而非整塊改走廊；MS004、PH001、EVRF003保留真小屋/房間候選。ENB1-005大柱網空間、SCB1-027大矩形與039混合真小房均用途/分界未明，保留候選待幾何處理。

本批後渲染候選879個、廊道另計；不是校園實際房間總數，也不以指標改善宣稱來源已完整核對。逐筆19項修正與9項保留理由見source-review-corrections.json，更新後source hashes與holes/verticalServices/凍結SC1/2檢查見alignment-validation.json。此後不擴其他樓層源圖審核。

### 最後三筆人工門口覆圖（不改來源JSON）

SC-B1-region053、EV4F-region009、EV6F-region017的原圖都有圍合牆與門弧，保留真實圖面空間；沒有為取得100%移掉候選。前者是兩側有門的矩形小房，後兩者是衛浴旁西側有門的L形小間，候選周界混入門扇/門弧線而被切碎。人工示意共享門分別連SC031、EV4F008、EV6F016，方向向西，寬1.0–1.1m；確切每房local點、原圖pixel、平行假門扇線及源圖overlay見final-three-door-source-review.json。幾何開洞需要處理同門帶上的平行假線，不能只切最近單邊。此報告不修改任何八棟JSON、註冊或已凍結SC1F/2F，因此八份來源SHA維持不變。

### EV1／EV6另外兩個電梯井更正

EV1F-region030與EV6F-region024的原圖放大皆明確為X電梯井與門槽，按與EV2／3／5相同來源語意，移至regionCandidates(vertical-service)並新增verticalServices封閉井體。原polygon/sourceRegionPixels/來源頁完整保留，不是為coverage刪房；當次渲染房間候選877，並非實際房間總數。elevator-shaft-source-review.json保存覆圖與更正前後EV SHA。final-three-door-source-review.json在逐物件比對原3房及3鄰房完全未變後刷新EV SHA，保留oldSHA、原因與六房canonical hash。

EV2F038、CH3F013（原圖明確印CH3020）、CH4F016的真圍合與門弧則保留；局部門扇/門弧帶的原圖pixel、示意門點local及覆圖另存retained-doorband-source-notes.json，未自動改source或geometry。
