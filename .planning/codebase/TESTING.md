# Testing & Verification

## Data Seeding
Use the following Anonymous Apex script to prepare the environment for a demo:
```java
// Seed Modem Stock
ProductItem pi = new ProductItem(
    Product2Id = [SELECT Id FROM Product2 WHERE Name LIKE '%Modem%' LIMIT 1].Id,
    LocationId = [SELECT Id FROM Location WHERE IsMobile = true LIMIT 1].Id,
    QuantityOnHand = 5,
    UnitOfMeasure = 'Each'
);
insert pi;
```

## Manual Verification Steps
1.  **UI Verification**: Click the FAB chat button to ensure the assistant opens/closes.
2.  **Voice Verification**: Use the mic icon to dictate "Do I have any modems?" and verify transcription.
3.  **Inventory Loop**: Ask "Who nearby has a modem?" and verify the peer lookup logic.
4.  **Cart Impact**: Add 2 TV Receivers and verify the "Draft Order" price update (+$30/mo).

## Agentforce Verification
- Ensure the **Inventory Management** Topic is **Active** in Agentforce Studio.
- Verify that the Topic has the `Check My Van Inventory` action linked.
