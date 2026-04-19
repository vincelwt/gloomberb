import { describe, expect, test } from "bun:test";
import { parseForm4Xml } from "./insider-data";

const SAMPLE_FORM4 = `<?xml version="1.0"?>
<ownershipDocument>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>
      <isOfficer>1</isOfficer>
      <officerTitle>Chief Executive Officer</officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2024-04-01</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>50000</value></transactionShares>
        <transactionPricePerShare><value>171.50</value></transactionPricePerShare>
      </transactionAmounts>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>3500000</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

describe("parseForm4Xml", () => {
  test("parses insider sale from Form 4 XML", () => {
    const result = parseForm4Xml(SAMPLE_FORM4);
    expect(result).not.toBeNull();
    expect(result!.reportedName).toBe("COOK TIMOTHY D");
    expect(result!.title).toBe("Chief Executive Officer");
    expect(result!.transactionType).toBe("S");
    expect(result!.shares).toBe(50000);
    expect(result!.pricePerShare).toBe(171.50);
    expect(result!.totalValue).toBe(50000 * 171.50);
    expect(result!.sharesOwned).toBe(3500000);
  });

  test("returns null for non-Form-4 XML", () => {
    expect(parseForm4Xml("<html>not a form</html>")).toBeNull();
    expect(parseForm4Xml("")).toBeNull();
  });
});
