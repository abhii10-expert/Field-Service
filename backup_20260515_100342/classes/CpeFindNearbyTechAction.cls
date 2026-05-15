public class CpeFindNearbyTechAction {
    @InvocableMethod(label='Find Nearby Peer Inventory' description='Finds other technicians within 10km who have a specific product in their van.')
    public static List<String> execute(List<String> productNames) {
        List<String> results = new List<String>();
        for(String name : productNames) {
            results.add(CpeAiAssistantController.findNearbyInventory(name));
        }
        return results;
    }
}
