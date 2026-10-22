package com.yogimangchi.content.member.validation;

import java.util.regex.Pattern;

/** Same Unicode L/N character categories as the Frontend's /u pattern; no trimming or normalization. */
public final class NicknamePolicy {
    public static final String REGEXP="^[\\p{L}\\p{N}]{1,8}$";
    private static final Pattern PATTERN=Pattern.compile(REGEXP);
    private NicknamePolicy() { }
    public static boolean isValid(String value) {
        if(value==null) return false;
        int length=value.codePointCount(0,value.length());
        return length>=1 && length<=8 && PATTERN.matcher(value).matches();
    }
}
