Product2 tvProd;
Product2 wifiProd;
Product2 modemProd;

try { tvProd = [SELECT Id FROM Product2 WHERE Name LIKE '%TV%' OR ProductCode = 'O_RES_TV_PLUS_STB' OR ProductCode = 'REC-TV-01' LIMIT 1]; } catch(Exception e) {}
try { wifiProd = [SELECT Id FROM Product2 WHERE Name LIKE '%Wi-Fi%' OR Name LIKE '%WiFi%' OR Name LIKE '%Access Point%' OR ProductCode = 'O_RES_HSI_INCL_ACCESS_POINT' OR ProductCode = 'WIFI-AP-02' LIMIT 1]; } catch(Exception e) {}
try { modemProd = [SELECT Id FROM Product2 WHERE Name LIKE '%Modem%' OR ProductCode = 'MODEM-01' LIMIT 1]; } catch(Exception e) {}

if (tvProd == null || wifiProd == null) {
    System.debug('Products not found.');
} else {
    // 1. Find 3 existing active SRs (excluding current user)
    List<ServiceResource> existingSRs = [SELECT Id, Name, LocationId, RelatedRecordId FROM ServiceResource WHERE IsActive=true AND ResourceType='T' AND RelatedRecordId != :UserInfo.getUserId() LIMIT 3];
    
    List<Schema.Location> locsToUpsert = new List<Schema.Location>();
    Schema.Location locRahul = new Schema.Location(Name='Rahul Van', LocationType='Van', IsInventoryLocation=true, IsMobile=true);
    Schema.Location locNeha = new Schema.Location(Name='Neha Van', LocationType='Van', IsInventoryLocation=true, IsMobile=true);
    Schema.Location locArun = new Schema.Location(Name='Arun Van', LocationType='Van', IsInventoryLocation=true, IsMobile=true);
    
    for (Schema.Location l : [SELECT Id, Name FROM Location WHERE Name IN ('Rahul Van', 'Neha Van', 'Arun Van')]) {
        if (l.Name == 'Rahul Van') locRahul.Id = l.Id;
        if (l.Name == 'Neha Van') locNeha.Id = l.Id;
        if (l.Name == 'Arun Van') locArun.Id = l.Id;
    }
    locsToUpsert.add(locRahul);
    locsToUpsert.add(locNeha);
    locsToUpsert.add(locArun);
    upsert locsToUpsert;

    List<ServiceResource> srsToUpdate = new List<ServiceResource>();
    if (existingSRs.size() > 0) {
        existingSRs[0].Name = 'Tech Rahul';
        existingSRs[0].LocationId = locRahul.Id;
        srsToUpdate.add(existingSRs[0]);
    }
    if (existingSRs.size() > 1) {
        existingSRs[1].Name = 'Tech Neha';
        existingSRs[1].LocationId = locNeha.Id;
        srsToUpdate.add(existingSRs[1]);
    }
    if (existingSRs.size() > 2) {
        existingSRs[2].Name = 'Tech Arun';
        existingSRs[2].LocationId = locArun.Id;
        srsToUpdate.add(existingSRs[2]);
    }
    
    if(!srsToUpdate.isEmpty()) update srsToUpdate;

    delete [SELECT Id FROM ProductItem WHERE LocationId IN :locsToUpsert];

    List<ProductItem> pis = new List<ProductItem>();
    pis.add(new ProductItem(LocationId=locRahul.Id, Product2Id=tvProd.Id, QuantityOnHand=2));
    if (modemProd != null) {
        pis.add(new ProductItem(LocationId=locRahul.Id, Product2Id=modemProd.Id, QuantityOnHand=1));
    }
    pis.add(new ProductItem(LocationId=locNeha.Id, Product2Id=tvProd.Id, QuantityOnHand=4));
    pis.add(new ProductItem(LocationId=locArun.Id, Product2Id=wifiProd.Id, QuantityOnHand=3));
    insert pis;

    System.debug('Successfully inserted demo data for nearby tech inventory.');
}
