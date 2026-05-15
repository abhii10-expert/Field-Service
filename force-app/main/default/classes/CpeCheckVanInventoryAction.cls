public class CpeCheckVanInventoryAction {
    @InvocableMethod(label='Check My Van Inventory' description='Checks if a specific product is in the current technician\'s van stock.')
    public static List<String> execute(List<String> productNames) {
        List<String> results = new List<String>();
        for(String name : productNames) {
            results.add(CpeAiAssistantController.checkMyInventory(name));
        }
        return results;
    }
}
